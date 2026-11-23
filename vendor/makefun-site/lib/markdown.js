// makefun-site's Markdown (README.md, "Markdown"): its own subset, lexed into block tokens and then rendered, in the
// shape of marked's lexer and parser. Blocks: ATX headings (each with an id), fenced code, thematic breaks,
// blockquotes, flat lists and paragraphs. Inline: code spans, strong, emphasis, links and backslash escapes. No raw
// HTML (every < is escaped), no setext headings, no indented code, no tables, no reference links, no underscore
// emphasis.

import { escapeHtml, slugify, uniqueSlug } from './text.js';

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const QUOTE = /^>/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  return BLANK.test(line) || FENCE_OPEN.test(line) || headingOf(line) !== null || HR.test(line);
}

/** A paragraph line as it is rendered: spaces and tabs at either end dropped. */
const trimLine = (line) => line.replace(/^[ \t]+|[ \t]+$/g, '');

/** `src`'s block tokens, in order. */
export function lex(src) {
  const lines = src.split('\n');
  const tokens = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(line)) {
      i++;
      continue;
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence !== null) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
      i++;
      tokens.push({ type: 'code', lang: fence[1], lines: body });
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      tokens.push({ type: 'heading', depth: heading.depth, text: heading.text });
      i++;
      continue;
    }
    if (HR.test(line)) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(/^> ?/, ''));
      tokens.push({ type: 'blockquote', lines: body.map(trimLine).filter((l) => l !== '') });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const marker = isOrdered ? ORDERED : BULLET;
      const items = [];
      while (i < lines.length) {
        const m = marker.exec(lines[i]);
        if (m !== null) {
          items.push([trimLine(isOrdered ? m[2] : m[1])]);
          i++;
        } else if (CONTINUED.test(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      tokens.push({ type: 'list', ordered: isOrdered, start: isOrdered ? Number(ordered[1]) : 1, items: items.map((parts) => parts.join('\n')) });
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < lines.length && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    tokens.push({ type: 'paragraph', text: body.join('\n') });
  }
  return tokens;
}

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

const INLINE_SPECIAL = /[\\`*[]/g;
export function inline(s, env) {
  let out = '';
  let start = 0;
  const n = s.length;
  INLINE_SPECIAL.lastIndex = 0;
  let m;
  while ((m = INLINE_SPECIAL.exec(s)) !== null) {
    const i = m.index;
    const c = s[i];
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      if (start < i) out += escapeHtml(s.slice(start, i));
      out += escapeHtml(s[i + 1]);
      start = i + 2;
      INLINE_SPECIAL.lastIndex = start;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (start < i) out += escapeHtml(s.slice(start, i));
        out += '<code>' + escapeHtml(s.slice(i + 1, j)) + '</code>';
        start = j + 1;
        INLINE_SPECIAL.lastIndex = start;
      }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          if (start < i) out += escapeHtml(s.slice(start, i));
          out += '<strong>' + inline(s.slice(i + 2, j), env) + '</strong>';
          start = j + 2;
          INLINE_SPECIAL.lastIndex = start;
        } else INLINE_SPECIAL.lastIndex = i + 2;
      } else {
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          if (start < i) out += escapeHtml(s.slice(start, i));
          out += '<em>' + inline(s.slice(i + 1, j), env) + '</em>';
          start = j + 1;
          INLINE_SPECIAL.lastIndex = start;
        }
      }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const mm = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = mm === -1 ? '' : s.slice(k + 2, mm);
      if (target !== '' && !/\s/.test(target)) {
        if (start < i) out += escapeHtml(s.slice(start, i));
        out += '<a href="' + escapeHtml(env.link(target)) + '">' + inline(s.slice(i + 1, k), env) + '</a>';
        start = mm + 1;
        INLINE_SPECIAL.lastIndex = start;
        continue;
      }
      continue;
    }
  }
  if (start < n) out += escapeHtml(s.slice(start));
  return out;
}

/**
 * `src` rendered: its HTML (each block on its own lines, a "\n" after the last), its table of contents (every level 2
 * and 3 heading: level, id and its inline HTML) and its excerpt (the first paragraph's inline HTML, or "").
 */
export function renderMarkdown(src, env) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  for (const t of lex(src)) {
    switch (t.type) {
      case 'heading': {
        const id = uniqueSlug(slugify(t.text), ids);
        const html = inline(t.text, env);
        blocks.push(`<h${t.depth} id="${id}">${html}</h${t.depth}>\n`);
        if (t.depth === 2 || t.depth === 3) toc.push({ level: t.depth, id, html });
        break;
      }
      case 'code': {
        const cls = t.lang === '' ? '' : ` class="language-${escapeHtml(t.lang)}"`;
        blocks.push(`<pre><code${cls}>${t.lines.map((l) => `${escapeHtml(l)}\n`).join('')}</code></pre>\n`);
        break;
      }
      case 'hr':
        blocks.push('<hr>\n');
        break;
      case 'blockquote':
        blocks.push((t.lines.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(t.lines.join('\n'), env)}</p>\n</blockquote>`) + '\n');
        break;
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul';
        const open = t.ordered && t.start !== 1 ? `<ol start="${t.start}">` : `<${tag}>`;
        blocks.push(`${open}\n${t.items.map((item) => `<li>${inline(item, env)}</li>\n`).join('')}</${tag}>\n`);
        break;
      }
      case 'paragraph': {
        const html = inline(t.text, env);
        if (excerpt === null) excerpt = html;
        blocks.push(`<p>${html}</p>\n`);
        break;
      }
    }
  }
  return { html: blocks.join(''), toc, excerpt: excerpt ?? '' };
}
