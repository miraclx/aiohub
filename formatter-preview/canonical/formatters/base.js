// Generated 2026-11-09 from AIOStreams ed8b085f081bc8442dc59ac9de4a4a2070b93f0a; AGPL-3.0-only.
// Type erasure; original source/notices in upstream/.
import * as constants from '../utils/constants.js';
import { formatHours, makeSmall } from './utils.js';
import { languageToCode, languageToEmoji } from '../utils/languages.js';
import { describedTracks } from '../utils/media-info.js';
import { compileTemplate as engineCompileTemplate } from './engine/compile.js';
import { canonicaliseField } from './engine/fields.js';
import { NEW_LINE_SENTINEL, REMOVE_LINE_SENTINEL } from './engine/sentinels.js';
import { comparatorFunctions } from './engine/comparators.js';
// stored tracks omit unset fields, which would read as unknown properties
const TRACK_DEFAULTS = {
    lang: null,
    codec: null,
    tag: null,
    tags: null,
    channels: null,
    title: null,
    default: false,
    forced: false,
    commentary: false,
    dub: false,
    original: false,
    hearingImpaired: false,
    visualImpaired: false,
};
function formatterTracks(tracks) {
    return describedTracks(tracks).map(({ index: _index, ...track }) => ({
        ...TRACK_DEFAULTS,
        ...track,
    }));
}
/** Reads a `section.property` path off the parse value. */
function readField(source, parseValue) {
    const [section, property] = source.trim().split('.');
    if (!section || !property)
        return undefined;
    const canonical = canonicaliseField(section, property);
    if (!canonical)
        return undefined;
    return parseValue?.[canonical[0]]?.[canonical[1]];
}
export class BaseFormatter {
    config;
    userData;
    formatterContext;
    precompiledNameFunction = null;
    precompiledDescriptionFunction = null;
    _compilationPromise;
    constructor(config, ctx) {
        this.config = config;
        this.userData = ctx.userData;
        this.formatterContext = ctx;
        // Start template compilation asynchronously in the background
        this._compilationPromise = this.compileTemplatesAsync();
    }
    async compileTemplatesAsync() {
        this.precompiledNameFunction = await this.getCompiledTemplate(this.config.name);
        this.precompiledDescriptionFunction = await this.getCompiledTemplate(this.config.description);
    }
    /**
     * Compiled templates, least-recently-used first. Budgeted by source length
     * because a compiled template costs roughly 40 bytes of heap per character.
     */
    static compiledTemplates = new Map();
    static cachedTemplateChars = 0;
    /** ~40 MiB of compiled templates, whatever the per-template limit is. */
    static MAX_CACHED_TEMPLATE_CHARS = 1_000_000;
    static EVICTION_SAMPLE = 16;
    async getCompiledTemplate(template) {
        const cache = BaseFormatter.compiledTemplates;
        const cached = cache.get(template);
        if (cached) {
            cached.uses += 1;
            // re-inserting moves it to the end, so it is evicted last
            cache.delete(template);
            cache.set(template, cached);
            return cached.compiled;
        }
        const compiled = await this.compileTemplate(template);
        if (template.length > BaseFormatter.MAX_CACHED_TEMPLATE_CHARS) {
            return compiled;
        }
        cache.set(template, { compiled, chars: template.length, uses: 1 });
        BaseFormatter.cachedTemplateChars += template.length;
        while (BaseFormatter.cachedTemplateChars >
            BaseFormatter.MAX_CACHED_TEMPLATE_CHARS) {
            if (!BaseFormatter.evictOne())
                break;
        }
        return compiled;
    }
    /**
     * Least-used of the oldest few, so one-off configurations cannot push out a
     * shared template. Surviving a scan costs a use, which ages out stale ones.
     */
    static evictOne() {
        const cache = BaseFormatter.compiledTemplates;
        const sample = [];
        for (const entry of cache) {
            sample.push(entry);
            if (sample.length >= BaseFormatter.EVICTION_SAMPLE)
                break;
        }
        if (!sample.length)
            return false;
        // strict `<` leaves ties with the oldest, where the walk started
        let [victimKey, victim] = sample[0];
        for (const [key, entry] of sample) {
            if (entry.uses < victim.uses)
                [victimKey, victim] = [key, entry];
        }
        for (const [key, entry] of sample) {
            if (key !== victimKey && entry.uses > 1)
                entry.uses -= 1;
        }
        cache.delete(victimKey);
        BaseFormatter.cachedTemplateChars -= victim.chars;
        return true;
    }
    async format(stream) {
        // Wait for template compilation to complete if it hasn't already
        await this._compilationPromise;
        if (!this.precompiledNameFunction || !this.precompiledDescriptionFunction) {
            throw new Error('Template compilation failed - formatter not ready');
        }
        const parseValue = this.convertStreamToParseValue(stream);
        return {
            name: this.precompiledNameFunction(parseValue),
            description: this.precompiledDescriptionFunction(parseValue),
        };
    }
    convertStreamToParseValue(stream) {
        // Get original language from formatter context instead of from the stream's languages array hack
        const getPaddedNumber = (number, length) => number.toString().padStart(length, '0');
        const formattedSeasonString = stream.parsedFile?.seasons?.length
            ? stream.parsedFile.seasons.length === 1
                ? `S${getPaddedNumber(stream.parsedFile.seasons[0], 2)}`
                : `S${getPaddedNumber(stream.parsedFile.seasons[0], 2)}-${getPaddedNumber(stream.parsedFile.seasons[stream.parsedFile.seasons.length - 1], 2)}`
            : undefined;
        const formattedEpisodeString = stream.parsedFile?.episodes?.length
            ? stream.parsedFile.episodes.length === 1
                ? `E${getPaddedNumber(stream.parsedFile.episodes[0], 2)}`
                : `E${getPaddedNumber(stream.parsedFile.episodes[0], 2)}-${getPaddedNumber(stream.parsedFile.episodes[stream.parsedFile.episodes.length - 1], 2)}`
            : undefined;
        const seasonEpisode = [
            formattedSeasonString,
            formattedEpisodeString,
        ].filter((v) => v !== undefined);
        const formattedFolderSeasonString = stream.parsedFile?.folderSeasons?.length
            ? stream.parsedFile.folderSeasons.length === 1
                ? `S${getPaddedNumber(stream.parsedFile.folderSeasons[0], 2)}`
                : `S${getPaddedNumber(stream.parsedFile.folderSeasons[0], 2)}-${getPaddedNumber(stream.parsedFile.folderSeasons[stream.parsedFile.folderSeasons.length - 1], 2)}`
            : undefined;
        const formattedFolderEpisodesString = stream.parsedFile?.folderEpisodes
            ?.length
            ? stream.parsedFile.folderEpisodes.length === 1
                ? `E${getPaddedNumber(stream.parsedFile.folderEpisodes[0], 2)}`
                : `E${getPaddedNumber(stream.parsedFile.folderEpisodes[0], 2)}-${getPaddedNumber(stream.parsedFile.folderEpisodes[stream.parsedFile.folderEpisodes.length - 1], 2)}`
            : undefined;
        const getFieldValues = (field) => {
            // capitalise first letter
            const key = field.charAt(0).toUpperCase() + field.slice(1);
            return [
                ...(this.userData[`preferred${key}`] ||
                    []),
                ...(this.userData[`required${key}`] ||
                    []),
                ...(this.userData[`included${key}`] ||
                    []),
            ];
        };
        const uniqueFieldValues = (field) => [
            ...new Set(getFieldValues(field)),
        ];
        const sortByUserPreference = (items, userPrefs) => {
            if (!items)
                return null;
            if (!userPrefs.length)
                return items;
            return [...items].sort((a, b) => {
                const aIndex = userPrefs.indexOf(a);
                const bIndex = userPrefs.indexOf(b);
                const aInPrefs = aIndex !== -1;
                const bInPrefs = bIndex !== -1;
                if (aInPrefs && bInPrefs) {
                    return aIndex - bIndex;
                }
                return aInPrefs ? -1 : bInPrefs ? 1 : 0;
            });
        };
        const userSpecifiedLanguages = [
            ...new Set(getFieldValues('languages').map((lang) => lang === 'Original' && this.formatterContext.originalLanguage
                ? this.formatterContext.originalLanguage
                : lang)),
        ];
        const userSpecifiedSubtitles = [
            ...new Set(getFieldValues('subtitles').map((lang) => lang === 'Original' && this.formatterContext.originalLanguage
                ? this.formatterContext.originalLanguage
                : lang)),
        ];
        const buildLanguageVariants = (values, userSpecifiedValues) => {
            const sortedValues = sortByUserPreference(values, userSpecifiedValues);
            const userValues = sortedValues
                ? sortedValues.filter((value) => userSpecifiedValues.includes(value))
                : null;
            const applyModifiers = (list, ...modifiers) => {
                if (!list)
                    return null;
                const modified = list.map((value) => modifiers.reduce((acc, modifier) => acc !== undefined ? (modifier(acc) ?? acc) : undefined, value));
                return [...new Set(modified.filter(Boolean))];
            };
            const emojis = applyModifiers(sortedValues, languageToEmoji);
            const userEmojis = applyModifiers(userValues, languageToEmoji);
            const codes = applyModifiers(sortedValues, (value) => languageToCode(value) || value.toUpperCase());
            const userCodes = applyModifiers(userValues, (value) => languageToCode(value) || value.toUpperCase());
            const smallCodes = applyModifiers(sortedValues, languageToCode, makeSmall);
            const userSmallCodes = applyModifiers(userValues, languageToCode, makeSmall);
            const usEmojis = applyModifiers(sortedValues, languageToEmoji, (emoji) => emoji.replace('🇬🇧', '🇺🇸🦅'));
            const userUsEmojis = applyModifiers(userValues, languageToEmoji, (emoji) => emoji.replace('🇬🇧', '🇺🇸🦅'));
            return {
                sortedValues,
                userValues,
                emojis,
                userEmojis,
                codes,
                userCodes,
                smallCodes,
                userSmallCodes,
                usEmojis,
                userUsEmojis,
            };
        };
        // built on first read: most templates reference none of the twenty
        // language/subtitle variants
        const memo = (build) => {
            let value;
            let built = false;
            return () => {
                if (!built) {
                    value = build();
                    built = true;
                }
                return value;
            };
        };
        const languageVariants = memo(() => buildLanguageVariants(stream.parsedFile?.languages, userSpecifiedLanguages));
        const subtitleVariants = memo(() => buildLanguageVariants(stream.parsedFile?.subtitles, userSpecifiedSubtitles?.length
            ? userSpecifiedSubtitles
            : userSpecifiedLanguages));
        // Original is resolved above, so these compare against stream values as-is
        const userLists = memo(() => ({
            languages: userSpecifiedLanguages,
            subtitles: userSpecifiedSubtitles.length
                ? userSpecifiedSubtitles
                : userSpecifiedLanguages,
            resolutions: uniqueFieldValues('resolutions'),
            qualities: uniqueFieldValues('qualities'),
            visualTags: uniqueFieldValues('visualTags'),
            audioTags: uniqueFieldValues('audioTags'),
            audioChannels: uniqueFieldValues('audioChannels'),
            encodes: uniqueFieldValues('encodes'),
            streamTypes: uniqueFieldValues('streamTypes'),
            releaseGroups: uniqueFieldValues('releaseGroups'),
            keywords: uniqueFieldValues('keywords'),
        }));
        const sortedAudioChannels = sortByUserPreference(stream.parsedFile?.audioChannels, getFieldValues('audioChannels'));
        const sortedAudioTags = sortByUserPreference(stream.parsedFile?.audioTags, getFieldValues('audioTags'));
        const sortedVisualTags = sortByUserPreference(stream.parsedFile?.visualTags, getFieldValues('visualTags'));
        const formattedAge = stream.age ? formatHours(stream.age) : null;
        const parseValue = {
            get user() {
                return userLists();
            },
            config: {
                addonName: this.userData.addonName ||
                    this.formatterContext.addonName ||
                    'AIOStreams',
            },
            stream: {
                filename: stream.filename || null,
                folderName: stream.folderName || null,
                size: stream.size || null,
                folderSize: stream.folderSize || null,
                library: stream.library ?? false,
                quality: stream.parsedFile?.quality || null,
                resolution: stream.parsedFile?.resolution || null,
                subbed: stream.parsedFile?.subbed || !!stream.parsedFile?.subtitles?.length,
                dubbed: stream.parsedFile?.dubbed || false,
                mediaInfoQuality: stream.parsedFile?.mediaInfoQuality ?? null,
                get languages() {
                    return languageVariants().sortedValues;
                },
                get uLanguages() {
                    return languageVariants().userValues;
                },
                get subtitles() {
                    return subtitleVariants().sortedValues;
                },
                get uSubtitles() {
                    return subtitleVariants().userValues;
                },
                get languageEmojis() {
                    return languageVariants().emojis;
                },
                get uLanguageEmojis() {
                    return languageVariants().userEmojis;
                },
                get subtitleEmojis() {
                    return subtitleVariants().emojis;
                },
                get uSubtitleEmojis() {
                    return subtitleVariants().userEmojis;
                },
                get languageCodes() {
                    return languageVariants().codes;
                },
                get uLanguageCodes() {
                    return languageVariants().userCodes;
                },
                get subtitleCodes() {
                    return subtitleVariants().codes;
                },
                get uSubtitleCodes() {
                    return subtitleVariants().userCodes;
                },
                get smallLanguageCodes() {
                    return languageVariants().smallCodes;
                },
                get uSmallLanguageCodes() {
                    return languageVariants().userSmallCodes;
                },
                get smallSubtitleCodes() {
                    return subtitleVariants().smallCodes;
                },
                get uSmallSubtitleCodes() {
                    return subtitleVariants().userSmallCodes;
                },
                get wedontknowwhatakilometeris() {
                    return languageVariants().usEmojis;
                },
                get uWedontknowwhatakilometeris() {
                    return languageVariants().userUsEmojis;
                },
                visualTags: sortedVisualTags,
                audioTags: sortedAudioTags,
                audioTracks: formatterTracks(stream.parsedFile?.audioTracks),
                subtitleTracks: formatterTracks(stream.parsedFile?.subtitleTracks),
                releaseGroup: stream.parsedFile?.releaseGroup || null,
                regexMatched: stream.regexMatched?.name || stream.rankedRegexesMatched?.[0] || null,
                rankedRegexMatched: stream.rankedRegexesMatched?.filter((name) => typeof name === 'string') || [],
                regexScore: stream.regexScore ?? null,
                nRegexScore: stream.regexScore != undefined &&
                    this.formatterContext.maxRegexScore != undefined &&
                    this.formatterContext.maxRegexScore > 0
                    ? Math.max(0, Math.min(100, Math.round((stream.regexScore / this.formatterContext.maxRegexScore) *
                        100)))
                    : null,
                encode: stream.parsedFile?.encode || null,
                audioChannels: sortedAudioChannels || null,
                indexer: stream.indexer || null,
                seeders: stream.torrent?.seeders ?? null,
                private: stream.torrent?.private ?? false,
                freeleech: stream.torrent?.freeleech ?? null,
                year: stream.parsedFile?.year || null,
                type: stream.type || null,
                title: stream.parsedFile?.title || null,
                country: stream.parsedFile?.country || null,
                episodeTitle: stream.parsedFile?.episodeTitle || null,
                date: stream.parsedFile?.date || null,
                season: stream.parsedFile?.seasons?.[0] || null,
                formattedSeasons: formattedSeasonString || null,
                seasons: stream.parsedFile?.seasons || null,
                folderSeasons: stream.parsedFile?.folderSeasons || null,
                formattedFolderSeasons: formattedFolderSeasonString || null,
                episode: stream.parsedFile?.episodes?.[0] || null,
                formattedEpisodes: formattedEpisodeString || null,
                episodes: stream.parsedFile?.episodes || null,
                formattedFolderEpisodes: formattedFolderEpisodesString || null,
                folderEpisodes: stream.parsedFile?.folderEpisodes || null,
                seasonEpisode: seasonEpisode || null,
                seasonPack: stream.parsedFile?.seasonPack ?? false,
                duration: stream.duration || null,
                bitrate: stream.bitrate ?? null,
                infoHash: stream.torrent?.infoHash || null,
                age: formattedAge,
                ageHours: stream.age || null,
                message: stream.message || null,
                proxied: stream.proxied ?? false,
                edition: stream.parsedFile?.editions?.[0] || null,
                editions: stream.parsedFile?.editions || null,
                regraded: stream.parsedFile?.regraded ?? false,
                remastered: null,
                repack: stream.parsedFile?.repack ?? false,
                proper: stream.parsedFile?.proper ?? false,
                uncensored: stream.parsedFile?.uncensored ?? false,
                unrated: stream.parsedFile?.unrated ?? false,
                upscaled: stream.parsedFile?.upscaled ?? false,
                hasChapters: stream.parsedFile?.hasChapters ?? false,
                network: stream.parsedFile?.network || null,
                site: stream.parsedFile?.site || null,
                container: stream.parsedFile?.container || null,
                extension: stream.parsedFile?.extension || null,
                seadex: stream.seadex?.isSeadex ?? false,
                seadexBest: stream.seadex?.isBest ?? false,
                nSeScore: stream.streamExpressionScore != undefined &&
                    this.formatterContext.maxSeScore != undefined &&
                    this.formatterContext.maxSeScore > 0
                    ? Math.max(0, Math.min(100, Math.round((stream.streamExpressionScore /
                        this.formatterContext.maxSeScore) *
                        100)))
                    : null,
                seScore: stream.streamExpressionScore ?? null,
                seMatched: stream.streamExpressionMatched?.name || null,
                rseMatched: stream.rankedStreamExpressionsMatched?.filter((name) => typeof name === 'string') || [],
                preloading: stream.preloading ?? false,
                idMatched: stream.idMatched ?? false,
            },
            metadata: {
                queryType: this.formatterContext.queryType || null,
                type: this.formatterContext.type || null,
                isAnime: this.formatterContext.isAnime ?? false,
                title: this.formatterContext.title || null,
                titles: this.formatterContext.titles || null,
                year: this.formatterContext.year || null,
                yearEnd: this.formatterContext.yearEnd || null,
                runtime: this.formatterContext.runtime || null,
                episodeRuntime: this.formatterContext.episodeRuntime || null,
                genres: this.formatterContext.genres || null,
                originalLanguage: this.formatterContext.originalLanguage || null,
                country: this.formatterContext.country || null,
                // ?? rather than ||: season 0 (specials) and a 0-day age are real values
                season: this.formatterContext.season ?? null,
                episode: this.formatterContext.episode ?? null,
                absoluteEpisode: this.formatterContext.absoluteEpisode ?? null,
                relativeAbsoluteEpisode: this.formatterContext.relativeAbsoluteEpisode ?? null,
                episodeTitle: this.formatterContext.episodeTitles?.[0] || null,
                episodeTitles: this.formatterContext.episodeTitles || null,
                latestSeason: this.formatterContext.latestSeason ?? null,
                daysSinceRelease: this.formatterContext.daysSinceRelease ?? null,
                daysSinceFirstAired: this.formatterContext.daysSinceFirstAired ?? null,
                daysSinceLastAired: this.formatterContext.daysSinceLastAired ?? null,
                hasNextEpisode: this.formatterContext.hasNextEpisode ?? false,
                daysUntilNextEpisode: this.formatterContext.daysUntilNextEpisode ?? null,
                anilistId: this.formatterContext.anilistId ?? null,
                malId: this.formatterContext.malId ?? null,
                hasSeaDex: this.formatterContext.hasSeaDex ?? false,
            },
            addon: {
                name: stream.addon?.name || null,
                presetId: stream.addon?.preset?.type || null,
                manifestUrl: stream.addon?.manifestUrl || null,
            },
            service: {
                id: stream.service?.id || null,
                shortName: stream.service?.id
                    ? Object.values(constants.SERVICE_DETAILS).find((service) => service.id === stream.service?.id)?.shortName || null
                    : null,
                name: stream.service?.id
                    ? Object.values(constants.SERVICE_DETAILS).find((service) => service.id === stream.service?.id)?.name || null
                    : null,
                cached: stream.service?.cached !== undefined ? stream.service?.cached : null,
            },
        };
        // spreading invokes the getters above, so every field is still present,
        // in declaration order
        parseValue.debug = {
            get json() {
                return JSON.stringify({ ...parseValue, debug: undefined });
            },
            get jsonf() {
                return JSON.stringify({ ...parseValue, debug: undefined }, (_, value) => value, 2);
            },
        };
        return parseValue;
    }
    async compileTemplate(str) {
        const compiled = this.compileWithEngine(str);
        return (parseValue) => {
            // layout comes from sentinels the template emitted, never from rendered text
            return compiled(parseValue)
                .split('\n')
                .filter((line) => line.trim() !== '' && !line.includes(REMOVE_LINE_SENTINEL))
                .join('\n')
                .replaceAll(NEW_LINE_SENTINEL, '\n');
        };
    }
    /**
     */
    compileWithEngine(str) {
        // Cached templates outlive this formatter, so no hook may reach `this`.
        let warn = this.formatterContext.onWarning;
        const compiled = engineCompileTemplate(str, {
            resolveVariable: (source, parseValue) => {
                const value = readField(source, parseValue);
                return value == null ? undefined : String(value);
            },
            resolveValues: (source, parseValue) => {
                const value = readField(source, parseValue);
                if (value == null)
                    return undefined;
                return Array.isArray(value)
                    ? value.filter((item) => typeof item === 'string')
                    : [String(value)];
            },
            comparators: comparatorFunctions,
            onDepthExceeded: (max) => warn?.(`Template nesting depth exceeded (max ${max}). Returning literal text.`),
        });
        warn = undefined;
        return compiled;
    }
}
