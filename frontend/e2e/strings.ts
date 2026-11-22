import arabic from "../messages/ar.json";
import english from "../messages/en.json";
import type { SupportedLanguage } from "../src/i18n/config";

// The interface text the tests look for, READ FROM THE REAL CATALOGUES (messages/<language>.json, Phase 4), so a changed or translated text can never make a
// test fail for the wrong reason. Typed against SupportedLanguage: adding a language to SUPPORTED is a compile error until its catalogue is listed here.
export interface UiStrings {
  /** The sign-in heading and the sign-in button. */
  signIn: string;
  email: string;
  password: string;
  /** Shown by the sign-in page (written in the frontend, for a 401 answer). */
  wrongPassword: string;
  openMenu: string;
  /** The accessible name of the main navigation. */
  mainNavigation: string;
  /** The Leads link of the main navigation (its label is "Leads / Clients"). */
  navLeads: RegExp;
  addLead: string;
  /** The heading of the company card on the settings screen. */
  companyCard: string;
  companyName: string;
  saveCompanySettings: string;
  /** The confirmation toast after saving the company settings. */
  companySettingsSaved: string;
  /** The accessible name of the dialog close button, of the dialog Cancel button, of the leads search box (a pattern) and of the leads Source filter. */
  closeDialog: string;
  cancel: string;
  searchLeads: RegExp;
  sourceFilter: string;
}

type Catalogue = Record<string, Record<string, string>>;
const CATALOGUES: Record<SupportedLanguage, Catalogue> = { en: english as unknown as Catalogue, ar: arabic as unknown as Catalogue };

const escapePattern = (text: string) => text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
/** The first word of a label as a pattern: the label is longer than what the tests need to match ("Leads / Clients", "Search name, phone, email…"). */
const firstWord = (text: string) => escapePattern(text.split(/[\s/]+/)[0]);

function stringsFor(language: SupportedLanguage): UiStrings {
  const c = CATALOGUES[language];
  return {
    signIn: c.auth.signIn,
    email: c.common.email,
    password: c.common.password,
    wrongPassword: c.auth.incorrectEmailOrPassword,
    openMenu: c.shell.openMenu,
    mainNavigation: c.shell.main,
    navLeads: new RegExp(firstWord(c.shell.navLeads)),
    addLead: c.common.addLead,
    companyCard: c.settings.company,
    companyName: c.settings.companyName,
    saveCompanySettings: c.settings.saveCompanySettings,
    companySettingsSaved: c.settings.companySettingsSaved,
    closeDialog: c.ui.close,
    cancel: c.common.cancel,
    searchLeads: new RegExp("^" + firstWord(c.leads.searchNamePhoneEmail)),
    sourceFilter: c.common.source,
  };
}

export const STRINGS: Record<SupportedLanguage, UiStrings> = { en: stringsFor("en"), ar: stringsFor("ar") };

/**
 * Text the tests read that is NOT part of the application's catalogue and does not depend on the interface language: temporary EXTERNAL exceptions.
 *  - the error page of Next.js itself (framework text, always English);
 * Backend-provided messages (API error texts) are not asserted anywhere in the suite today; when one is, it belongs here until the backend sends codes.
 */
export const EXTERNAL_TEXT = {
  nextErrorPage: /Application error|Unhandled Runtime Error|This page could not be found/i,
} as const;
