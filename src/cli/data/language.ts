import type { CliDataPage } from "./page.js";

export interface SupportedLanguageData {
  readonly locale: string;
  readonly name: string;
}

export interface LanguageListData {
  readonly schema: "benchpilot.language-list";
  readonly version: 1;
  readonly languages: readonly SupportedLanguageData[];
}

export interface LanguageData {
  readonly schema: "benchpilot.language";
  readonly version: 1;
  readonly language: SupportedLanguageData;
}

const languageData = (input: {
  readonly value: string;
  readonly label: string;
}): SupportedLanguageData => ({ locale: input.value, name: input.label });

export const languageListPage = (
  data: LanguageListData,
): CliDataPage<LanguageListData> => {
  return {
    data,
    jsonl: data.languages.map((language) => ({
      key: `languages.${language.locale}`,
      value: language,
    })),
  };
};

export const languageListDataPage = (
  languages: readonly { readonly value: string; readonly label: string }[],
) =>
  languageListPage({
    schema: "benchpilot.language-list",
    version: 1,
    languages: languages.map(languageData),
  });

export const languagePage = (
  data: LanguageData,
): CliDataPage<LanguageData> => ({ data });

export const languageDataPage = (
  locale: string,
  languages: readonly { readonly value: string; readonly label: string }[],
) => {
  const selected = languages.find((language) => language.value === locale);
  return languagePage({
    schema: "benchpilot.language",
    version: 1,
    language: languageData(selected ?? { value: locale, label: locale }),
  });
};
