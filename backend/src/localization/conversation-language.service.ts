import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  ConversationLocale,
  detectLanguageEvidence,
  languageFor,
  normalizeLocale,
} from './localization';

type LocaleSource = 'tenant_default' | 'contact_preference' | 'detected';

type LanguageState = {
  language_locale: string | null;
  language_source: LocaleSource | null;
  language_candidate_locale: string | null;
  language_candidate_count: number;
  contact_locale: string | null;
};

export type ResolvedConversationLocale = {
  locale: ConversationLocale;
  source: LocaleSource;
};

const SWITCH_EVIDENCE_THRESHOLD = 2;

@Injectable()
export class ConversationLanguageService {
  async resolve(
    client: PoolClient,
    conversationId: string,
    message: string,
    tenantLocale: string,
  ): Promise<ResolvedConversationLocale> {
    const result = await client.query<LanguageState>(
      `select conversation.language_locale,conversation.language_source,
              conversation.language_candidate_locale,conversation.language_candidate_count,
              contact.locale as contact_locale
         from app.conversations conversation
         join app.contacts contact
           on contact.tenant_id=conversation.tenant_id and contact.id=conversation.contact_id
        where conversation.id=$1
        for update of conversation`,
      [conversationId],
    );
    const state = result.rows[0];
    if (!state) throw new Error('Conversation language state not found');
    const evidence = detectLanguageEvidence(message);

    if (!state.language_locale) {
      const contactLocale = state.contact_locale
        ? normalizeLocale(state.contact_locale)
        : null;
      const locale = contactLocale ?? evidence ?? normalizeLocale(tenantLocale);
      const source: LocaleSource = contactLocale
        ? 'contact_preference'
        : evidence && languageFor(tenantLocale) !== evidence
          ? 'detected'
          : 'tenant_default';
      await this.persist(client, conversationId, locale, source, null, 0);
      return { locale, source };
    }

    const currentLanguage = languageFor(state.language_locale);
    if (!evidence || evidence === currentLanguage) {
      if (state.language_candidate_locale)
        await this.persist(
          client,
          conversationId,
          state.language_locale,
          state.language_source ?? 'tenant_default',
          null,
          0,
        );
      return {
        locale: state.language_locale,
        source: state.language_source ?? 'tenant_default',
      };
    }

    const candidateCount =
      state.language_candidate_locale === evidence
        ? state.language_candidate_count + 1
        : 1;
    if (candidateCount >= SWITCH_EVIDENCE_THRESHOLD) {
      await this.persist(client, conversationId, evidence, 'detected', null, 0);
      return { locale: evidence, source: 'detected' };
    }
    await this.persist(
      client,
      conversationId,
      state.language_locale,
      state.language_source ?? 'tenant_default',
      evidence,
      candidateCount,
    );
    return {
      locale: state.language_locale,
      source: state.language_source ?? 'tenant_default',
    };
  }

  private persist(
    client: PoolClient,
    conversationId: string,
    locale: string,
    source: LocaleSource,
    candidateLocale: string | null,
    candidateCount: number,
  ) {
    return client.query(
      `update app.conversations
          set language_locale=$2,language_source=$3,
              language_candidate_locale=$4,language_candidate_count=$5,
              language_updated_at=now(),updated_at=now()
        where id=$1`,
      [conversationId, locale, source, candidateLocale, candidateCount],
    );
  }
}
