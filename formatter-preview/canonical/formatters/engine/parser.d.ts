// App-owned boundary declaration. Implementation is the pinned canonical parser.
export function validateTemplate(template: string): {index: number; category: string; message: string; source: string; suggestion?: string}[];
