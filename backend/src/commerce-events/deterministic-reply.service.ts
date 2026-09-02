import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { InteractiveMessage } from '../interactive-messages/interactive-message.types';
import { catalogFor, ConversationLocale, formatMoney, interpolate, languageFor, MessageIntentKey, stripLeadingGreeting } from '../localization/localization';
import { ResponsePlan } from '../response-composition/response-plan.types';

// vegetarian/spicy/allergens/pickup/preparation_time used to be fixed,
// globally-shared intents here — restaurant-shaped vocabulary baked into a
// catalog every tenant read, regardless of vertical (D-078). They're gone as
// *classified* intents; a message that would have hit one of them just
// becomes 'fallback' now, which already routes to knowledgeReply() below —
// answered (or not) purely by each tenant's own published knowledge_entries
// and their own `keywords`, never by shared, hardcoded, cross-tenant terms.
export type ReplyIntent =
  | 'greeting'
  | 'handoff'
  | 'menu'
  | 'price'
  | 'hours'
  | 'location'
  | 'delivery'
  | 'payments'
  | 'order'
  | 'appointment'
  | 'fallback';

export interface DeterministicReply {
  intent: ReplyIntent;
  body: string;
  handoff: boolean;
  sources: string[];
  interactive?: InteractiveMessage;
  responsePlan?:ResponsePlan;
}

export interface BotCopy {
  locale: ConversationLocale;
  welcomeMessage: string;
  fallbackMessage: string;
  handoffKeywords: string[];
  customerName?: string | null;
}

interface OfferingRow {
  item_id: string;
  variant_id: string;
  name: string;
  category: string | null;
  variant_name: string;
  price_minor: string;
  currency: string;
}

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const includesAny = (text: string, words: string[]): boolean => words.some((word) => text.includes(word));

const truncate = (value: string, max: number): string => value.length > max ? `${value.slice(0, max - 1)}…` : value;

export function classifyMessage(message: string, handoffKeywords: string[] = [], locale: ConversationLocale = 'es'): ReplyIntent {
  const text = normalize(message);
  if (handoffKeywords.some((word) => text.includes(normalize(word)))) return 'handoff';
  const intents=catalogFor(locale).intents;
  const fallbackIntents=catalogFor('en').intents;
  const ordered:MessageIntentKey[]=['delivery','hours','location','payments','price','menu'];
  for(const intent of ordered)if(includesAny(text,[...intents[intent],...fallbackIntents[intent]].map(normalize)))return intent;
  if([...intents.greeting,...fallbackIntents.greeting].some(greeting=>text===normalize(greeting)||text.startsWith(`${normalize(greeting)} `)))return 'greeting';
  return 'fallback';
}

@Injectable()
export class DeterministicReplyService {
  async resolve(client: PoolClient, message: string, bot: BotCopy): Promise<DeterministicReply> {
    const intent = classifyMessage(message, bot.handoffKeywords, bot.locale);
    const localeCatalog=catalogFor(bot.locale);
    const copy = localeCatalog.bot;
    if (intent === 'handoff') {
      return { intent, handoff: true, sources: [], body: copy.handoff };
    }
    if (intent === 'greeting') {
      const firstName=bot.customerName?.trim().split(/\s+/)[0]?.slice(0,60);
      const personalized=!firstName?bot.welcomeMessage
        : interpolate(localeCatalog.bot.personalizedGreeting,{name:firstName,welcome:stripLeadingGreeting(bot.welcomeMessage,bot.locale)});
      return { intent, handoff: false, sources: ['bot_configuration'], body: personalized };
    }
    if (
      intent === 'menu' || intent === 'price' ||
      intent === 'hours' || intent === 'location' || intent === 'delivery' || intent === 'payments'
    ) {
      // Every one of these fixed intents has a keyword that can also appear
      // in an unrelated, tenant-specific FAQ — "productos" for menu/price
      // (D-077), and just as easily "atienden" for hours ("¿Atienden
      // niños?" is a barbershop FAQ about kids' haircuts, not a question
      // about opening hours — found live running the Fase 2 acceptance
      // matrix). A specific title/keyword match always wins over the
      // generic catalog/price/profile dispatch; with no match, each intent
      // falls through to its normal handling exactly as before.
      const rows = await this.publishedKnowledgeEntries(client, bot.locale);
      const specific = this.findSpecificKnowledgeEntry(rows, message);
      if (specific) {
        return { intent, handoff: false, sources: [`knowledge_entry:${specific.id}`], body: specific.content };
      }
      if (intent === 'menu' || intent === 'price') {
        return this.offeringReply(client, message, intent, copy, bot.locale);
      }
      return this.profileReply(client, intent, bot.fallbackMessage, bot.locale);
    }
    // Every other message — anything that isn't one of the small, genuinely
    // universal fixed intents above — is answered purely from this tenant's
    // own published knowledge_entries (title or per-entry keywords), never
    // from a shared vertical-specific vocabulary. See D-078.
    return this.knowledgeReply(client, message, intent, bot.fallbackMessage, bot.locale);
  }

  private async offeringReply(
    client: PoolClient,
    message: string,
    intent: 'menu' | 'price',
    copy: { menuUnavailable: string; productQuestion: string; menuHeading: string; priceHeading: string; menuButtonLabel: string },
    locale: ConversationLocale,
  ): Promise<DeterministicReply> {
    const result = await client.query<OfferingRow>(
      `select item.id::text as item_id,variant.id::text as variant_id,
              coalesce(item_loc.name,item.name) as name,item.category,
              coalesce(variant_loc.name,variant.name) as variant_name,
              variant.price_minor::text,variant.currency
         from app.catalog_items item
         join app.item_variants variant on variant.tenant_id=item.tenant_id and variant.catalog_item_id=item.id
         left join app.catalog_item_localizations item_loc
           on item_loc.tenant_id=item.tenant_id and item_loc.catalog_item_id=item.id and item_loc.locale=$1
         left join app.item_variant_localizations variant_loc
           on variant_loc.tenant_id=variant.tenant_id and variant_loc.item_variant_id=variant.id and variant_loc.locale=$1
        where item.status='active' and variant.status='active' and variant.availability_status='available'
          and variant.availability_status in ('available','unknown')
        order by item.category,item.name,variant.price_minor`,
      [languageFor(locale)],
    );
    if (result.rowCount === 0) {
      return { intent, handoff: false, sources: [], body: copy.menuUnavailable };
    }

    let rows = result.rows;
    if (intent === 'menu') {
      const ignored = new Set(catalogFor(locale).stopWords.map(normalize));
      const inputTokens = new Set(normalize(message).split(' ').filter((token) => token.length > 2 && !ignored.has(token)));
      const scored = rows.map((row) => ({
        row,
        score: normalize(`${row.name} ${row.category ?? ''}`).split(' ').filter((token) => inputTokens.has(token)).length,
      }));
      const bestScore = Math.max(0, ...scored.map(({ score }) => score));
      if (bestScore > 0) rows = scored.filter(({ score }) => score === bestScore).map(({ row }) => row);
    }
    if (intent === 'price') {
      const ignored = new Set(catalogFor(locale).stopWords.map(normalize));
      const inputTokens = new Set(normalize(message).split(' ').filter((token) => token.length > 2 && !ignored.has(token)));
      const scored = rows.map((row) => ({
        row,
        score: normalize(row.name).split(' ').filter((token) => inputTokens.has(token)).length,
      }));
      const bestScore = Math.max(0, ...scored.map(({ score }) => score));
      const matches = scored.filter(({ score }) => score === bestScore && score > 0).map(({ row }) => row);
      if (matches.length > 0) rows = matches;
      else return { intent, handoff: false, sources: [], body: copy.productQuestion };
    }

    const labels = catalogFor(locale).labels;
    const rowInfo = rows.map((row) => {
      const price = formatMoney(row.price_minor, row.currency, locale);
      const variantLabel = row.variant_name === labels.unit || row.variant_name.startsWith(labels.orderPrefix)
        ? '' : row.variant_name;
      return { row, price, variantLabel };
    });
    const lines = rowInfo.map(({ row, price, variantLabel }) =>
      `• ${row.name}${variantLabel ? ` (${variantLabel})` : ''}: ${price}`);
    const heading = intent === 'menu' ? copy.menuHeading : copy.priceHeading;
    // A menu with a tappable list lets a customer start an order with one
    // tap (the row title becomes the next inbound message, which the order
    // flow's bare-name matching then resolves — see commercial-flow.service
    // itemChoiceReply for the same title-as-command pattern). Skipped for
    // "price" (usually a single filtered row, nothing to pick) and for a
    // menu larger than WhatsApp's 10-row list limit.
    const interactive: InteractiveMessage | undefined =
      intent === 'menu' && rowInfo.length > 0 && rowInfo.length <= 10
        ? {
            type: 'list',
            body: '',
            buttonLabel: copy.menuButtonLabel,
            options: rowInfo.map(({ row, price, variantLabel }) => ({
              id: row.variant_id,
              title: truncate(row.name, 24),
              description: truncate(variantLabel ? `${variantLabel} · ${price}` : price, 72),
            })),
          }
        : undefined;
    // The tappable list already shows every product (name, variant, price)
    // as its own row — repeating that as bullet lines in the body as well
    // is pure duplication once WhatsApp renders both. Only fall back to the
    // full text listing when there's no list to tap (menu bigger than
    // Meta's 10-row limit, or a "price" reply, which never gets a list).
    const body = interactive ? heading : `${heading}\n${lines.join('\n')}`;
    return {
      intent,
      handoff: false,
      sources: [...new Set(rows.map((row) => `catalog_item:${row.item_id}`))],
      body,
      ...(interactive ? { interactive } : {}),
    };
  }

  private async profileReply(client: PoolClient, intent: 'hours' | 'location' | 'delivery' | 'payments', fallback: string, locale: ConversationLocale): Promise<DeterministicReply> {
    const result = await client.query<{ address: string; business_hours: string; fulfillment_options: string; payment_methods: string }>(
      `select coalesce(localized.address,profile.address) as address,
              coalesce(localized.business_hours,profile.business_hours) as business_hours,
              coalesce(localized.fulfillment_options,profile.fulfillment_options) as fulfillment_options,
              coalesce(localized.payment_methods,profile.payment_methods) as payment_methods
         from app.business_profiles profile
         left join app.business_profile_localizations localized
           on localized.tenant_id=profile.tenant_id and localized.locale=$1
        limit 1`,
      [languageFor(locale)],
    );
    const profile = result.rows[0];
    const field = intent === 'hours' ? 'business_hours'
      : intent === 'location' ? 'address'
      : intent === 'delivery' ? 'fulfillment_options'
      : 'payment_methods';
    const body = profile?.[field];
    return { intent, handoff: false, sources: body ? ['business_profile'] : [], body: body || fallback };
  }

  private async publishedKnowledgeEntries(client: PoolClient, locale: ConversationLocale) {
    const result = await client.query<{ id: string; title: string; content: string; keywords: string[] }>(
      `select entry.id::text,
              coalesce(loc.title,entry.title) as title,
              coalesce(loc.content,entry.content) as content,
              coalesce(entry.keywords,'{}') as keywords
         from app.knowledge_entries entry
         left join app.knowledge_entry_localizations loc
           on loc.tenant_id=entry.tenant_id and loc.knowledge_entry_id=entry.id and loc.locale=$1
        where entry.status='published' order by entry.title`,
      [languageFor(locale)],
    );
    return result.rows;
  }

  // Shared by knowledgeReply and resolve()'s menu/price pre-check: the
  // single, tenant-agnostic mechanism for deciding whether a published
  // knowledge entry answers this message — never a fixed, shared, vertical
  // intent vocabulary (see D-078). A message matches an entry when either:
  //  - its title echoes the question closely (exact, or shares enough
  //    significant words, scaled to the title's own length — D-076), or
  //  - the entry's own `keywords` (curated per tenant, per entry — the
  //    replacement for the old global allergens/vegetarian/spicy/pickup/
  //    preparation_time term lists) appear as a substring of the question.
  private findSpecificKnowledgeEntry(
    rows: { id: string; title: string; content: string; keywords: string[] }[],
    message: string,
  ): { id: string; title: string; content: string } | undefined {
    const ignored = new Set([...catalogFor('en').stopWords,...catalogFor('es').stopWords]);
    const question = normalize(message);
    const questionTokens = new Set(question.split(' ').filter((token) => token.length > 2 && !ignored.has(token)));
    const ranked = rows.map((row) => {
      const title = normalize(row.title);
      const titleTokens = new Set(title.split(' ').filter((token) => token.length > 2 && !ignored.has(token)));
      const titleOverlap = [...titleTokens].filter((token) => questionTokens.has(token)).length;
      const keywordMatch = (row.keywords ?? []).some((keyword) => {
        const normalized = normalize(keyword);
        return normalized.length > 0 && question.includes(normalized);
      });
      return { row, exact: title === question, titleOverlap, titleTokenCount: titleTokens.size, keywordMatch };
    });
    // Requiring >= 2 shared title words unconditionally made a short,
    // natural title ("Garantía") practically unfindable by any paraphrase,
    // since there was only ever one word to overlap with in the first place
    // — found live testing a non-restaurant tenant (D-075). The bar scales
    // down to the title's own word count instead of a flat 2.
    return ranked
      .filter(
        ({ exact, titleOverlap, titleTokenCount, keywordMatch }) =>
          exact ||
          (titleTokenCount > 0 && titleOverlap >= Math.min(2, titleTokenCount)) ||
          keywordMatch,
      )
      .sort((left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.titleOverlap - left.titleOverlap ||
        Number(right.keywordMatch) - Number(left.keywordMatch),
      )[0]?.row;
  }

  private async knowledgeReply(client: PoolClient, message: string, intent: ReplyIntent, fallback: string, locale: ConversationLocale): Promise<DeterministicReply> {
    const rows = await this.publishedKnowledgeEntries(client, locale);
    const entry = this.findSpecificKnowledgeEntry(rows, message);
    return { intent, handoff: false, sources: entry ? [`knowledge_entry:${entry.id}`] : [], body: entry?.content ?? fallback };
  }
}
