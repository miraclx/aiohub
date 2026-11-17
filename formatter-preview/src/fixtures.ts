import type {FixtureId} from './protocol.ts';

// Constructed here, never from a configuration/export/person/stream DTO.
// Intentionally small sample byte values also bound native numeric modifiers.
export function buildSyntheticFixture(id: FixtureId) {
  const context = {
    userData: {addonName: 'Synthetic preview', presets: [], sortCriteria: {global: []}, preferredLanguages: ['English'], preferredSubtitles: ['English']},
    title: 'Synthetic title', type: 'movie', queryType: 'movie', originalLanguage: 'English',
    year: 2024, maxRegexScore: 100, maxSeScore: 100,
  };
  const addon = {name: 'Synthetic addon', preset: {type: 'custom', id: 'synthetic', options: {}}, enabled: true, manifestUrl: 'https://example.invalid/manifest.json', timeout: 1000};
  if (id === 'missing') return {context, stream: {id: 'synthetic-missing', type: 'http', addon}};
  const stream = {id: 'synthetic-basic', type: 'http', addon, service: {id: 'torbox', cached: false}, parsedFile: {resolution: '1080p'}};
  if (id === 'basic') return {context, stream};
  return {context, stream: {
    ...stream, id: 'synthetic-detailed', filename: 'Synthetic.Example.1080p.mkv', size: 1_048_576, folderSize: 2_097_152, bitrate: 128_000, duration: 60_000,
    service: {id: 'torbox', cached: true},
    parsedFile: {resolution: '1080p', quality: 'WEB-DL', encode: 'HEVC', title: 'Synthetic title', year: '2024',
      languages: ['English', 'French'], subtitles: ['English'], audioChannels: ['5.1'], audioTags: ['AAC'], visualTags: ['HDR'],
      seasons: [1], episodes: [2], audioTracks: [{index: 0, lang: 'English', codec: 'AAC', channels: '5.1', default: true}, {index: 1}],
      subtitleTracks: [{index: 0, lang: 'English', forced: false}], editions: ['Synthetic edition']},
    regexScore: 60, rankedRegexesMatched: ['Synthetic match'],
  }};
}
