declare module 'formatter-preview' {
  export const FIXTURES: readonly {id: string; label: string}[];
  export class FormatterPreviewClient {
    render(template: {name: string; description: string}, fixture?: string): Promise<{output: {name: string; description: string}; warnings: number}>;
    cancel(): void;
  }
}
