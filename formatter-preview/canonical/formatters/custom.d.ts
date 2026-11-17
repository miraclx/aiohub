// App-owned boundary declaration, not a replacement formatter/schema.
export class CustomFormatter {
  static fromConfig(config: {name: string; description: string}, context: Record<string, unknown>): CustomFormatter;
  format(stream: Record<string, unknown>): Promise<{name: string; description: string}>;
}
