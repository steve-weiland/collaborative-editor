import type { Awareness } from 'y-protocols/awareness';
import type { PresenceState } from './presence';

/**
 * v2.2.0 visual cursor overlays.
 *
 * Renders an absolutely-positioned vertical bar + name badge for each
 * remote client whose awareness state has a non-null `cursor`. Pixel
 * coordinates come from a hidden mirror `<div>` whose computed style
 * is copied from the textarea — the canonical pattern for textarea
 * cursor geometry, since textareas don't expose Range/getClientRects.
 *
 * (DOC-130-136, F12.)
 */

// CSS properties that affect text layout. Copied from the textarea onto
// the mirror so word-wrap and line height match exactly.
const STYLE_PROPS_TO_COPY = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'wordSpacing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'boxSizing',
  'textTransform',
  'textIndent',
  'tabSize',
] as const;

interface OverlayEntry {
  wrap: HTMLElement;
  bar: HTMLElement;
  label: HTMLElement;
}

export class CursorOverlay {
  private mirror: HTMLDivElement;
  private overlays = new Map<number, OverlayEntry>();
  private rafHandle: number | null = null;
  private resizeObs: ResizeObserver;
  private destroyed = false;
  private readonly onAwarenessChange = (): void => this.scheduleRender();
  private readonly onInputOrScroll = (): void => this.scheduleRender();
  private readonly onResize = (): void => this.scheduleRender();

  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly container: HTMLElement,
    private readonly aw: Awareness,
  ) {
    this.mirror = document.createElement('div');
    this.mirror.setAttribute('aria-hidden', 'true');
    this.mirror.className = 'cursor-overlay-mirror';
    Object.assign(this.mirror.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word',
    });
    container.appendChild(this.mirror);

    aw.on('change', this.onAwarenessChange);
    textarea.addEventListener('input', this.onInputOrScroll);
    textarea.addEventListener('scroll', this.onInputOrScroll);
    window.addEventListener('resize', this.onResize);
    this.resizeObs = new ResizeObserver(this.onResize);
    this.resizeObs.observe(textarea);

    this.scheduleRender();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.aw.off('change', this.onAwarenessChange);
    this.textarea.removeEventListener('input', this.onInputOrScroll);
    this.textarea.removeEventListener('scroll', this.onInputOrScroll);
    window.removeEventListener('resize', this.onResize);
    this.resizeObs.disconnect();
    this.mirror.remove();
    for (const entry of this.overlays.values()) entry.wrap.remove();
    this.overlays.clear();
  }

  private scheduleRender(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      if (!this.destroyed) this.render();
    });
  }

  private syncMirrorStyle(): void {
    const cs = getComputedStyle(this.textarea);
    for (const prop of STYLE_PROPS_TO_COPY) {
      this.mirror.style[prop as never] = cs[prop as never];
    }
    const { width, height } = this.textarea.getBoundingClientRect();
    this.mirror.style.width = `${width}px`;
    this.mirror.style.minHeight = `${height}px`;
  }

  private getLineHeight(): number {
    const cs = getComputedStyle(this.textarea);
    const lh = parseFloat(cs.lineHeight);
    if (!Number.isNaN(lh)) return lh;
    const fs = parseFloat(cs.fontSize) || 16;
    return fs * 1.5;
  }

  private measure(offset: number): { left: number; top: number; height: number } {
    this.syncMirrorStyle();
    const value = this.textarea.value;
    const safe = Math.max(0, Math.min(offset, value.length));

    while (this.mirror.firstChild) this.mirror.removeChild(this.mirror.firstChild);
    this.mirror.appendChild(document.createTextNode(value.slice(0, safe)));
    const marker = document.createElement('span');
    marker.textContent = '​';
    this.mirror.appendChild(marker);
    // Trailing text after the marker keeps the marker on the correct line
    // when the offset sits right before a hard line break (otherwise the
    // marker collapses onto the previous line). Empty trailing text is fine.
    this.mirror.appendChild(document.createTextNode(value.slice(safe) || '​'));

    const markerRect = marker.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    return {
      left: markerRect.left - containerRect.left - this.textarea.scrollLeft,
      top: markerRect.top - containerRect.top - this.textarea.scrollTop,
      height: this.getLineHeight(),
    };
  }

  private render(): void {
    const me = this.aw.clientID;
    const seen = new Set<number>();

    this.aw.getStates().forEach((state, clientId) => {
      if (clientId === me) return;
      const s = state as Partial<PresenceState>;
      if (s.cursor === null || s.cursor === undefined) return;

      const pos = this.measure(s.cursor);
      seen.add(clientId);

      const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(s.color ?? '') ? s.color! : '#888';
      const safeName = (s.name ?? '?').replace(/[<>&]/g, '').slice(0, 32) || '?';

      let entry = this.overlays.get(clientId);
      if (!entry) {
        const wrap = document.createElement('div');
        wrap.className = 'cursor-overlay';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.setAttribute('data-client-id', String(clientId));
        const bar = document.createElement('div');
        bar.className = 'cursor-overlay-bar';
        const label = document.createElement('div');
        label.className = 'cursor-overlay-label';
        wrap.appendChild(bar);
        wrap.appendChild(label);
        this.container.appendChild(wrap);
        entry = { wrap, bar, label };
        this.overlays.set(clientId, entry);
      }

      entry.wrap.style.setProperty('--cursor-color', safeColor);
      entry.wrap.style.left = `${pos.left}px`;
      entry.wrap.style.top = `${pos.top}px`;
      entry.wrap.style.height = `${pos.height}px`;
      if (entry.label.textContent !== safeName) entry.label.textContent = safeName;
    });

    for (const [clientId, entry] of this.overlays) {
      if (!seen.has(clientId)) {
        entry.wrap.remove();
        this.overlays.delete(clientId);
      }
    }
  }
}
