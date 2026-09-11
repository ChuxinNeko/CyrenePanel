declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

declare module "@xterm/xterm/css/xterm.css" {
  const content: Record<string, string>;
  export default content;
}

declare module "js-yaml";

// noVNC 不带类型声明，这里按用到的接口给一份最小声明
declare module "@novnc/novnc" {
  interface RFBOptions {
    credentials?: { username?: string; password?: string; target?: string };
    shared?: boolean;
    repeaterID?: string;
    wsProtocols?: string[];
  }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrDataChannel: string, options?: RFBOptions);
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    background: string;
    clipViewport: boolean;
    focusOnClick: boolean;
    /** JPEG 画质 0-9，越高越清晰、越占带宽 */
    qualityLevel: number;
    /** zlib 压缩力度 0-9 */
    compressionLevel: number;
    disconnect(): void;
    focus(): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
  }
}
