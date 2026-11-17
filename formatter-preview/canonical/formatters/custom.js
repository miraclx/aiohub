// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
import { BaseFormatter } from './base.js';
export class CustomFormatter extends BaseFormatter {
    constructor(nameTemplate, descriptionTemplate, ctx) {
        super({
            name: nameTemplate,
            description: descriptionTemplate,
        }, ctx);
    }
    static fromConfig(config, ctx) {
        return new CustomFormatter(config.name, config.description, ctx);
    }
    updateTemplate(nameTemplate, descriptionTemplate) {
        this.config = {
            name: nameTemplate,
            description: descriptionTemplate,
        };
    }
    getTemplate() {
        return this.config;
    }
}
