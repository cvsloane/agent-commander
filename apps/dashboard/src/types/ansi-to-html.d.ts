declare module 'ansi-to-html' {
  interface AnsiToHtmlOptions {
    fg?: string;
    bg?: string;
    newline?: boolean;
    escapeXML?: boolean;
    stream?: boolean;
  }

  export default class AnsiToHtml {
    constructor(options?: AnsiToHtmlOptions);
    toHtml(input: string): string;
  }
}
