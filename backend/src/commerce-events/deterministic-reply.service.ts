import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { InteractiveMessage, truncate } from '../interactive-messages/interactive-message.types';
import {
  catalogFor,
  ConversationLocale,
  formatMoney,
  interpolate,
  languageFor,
  MessageIntentKey,
  normalizeForMatching as normalize,
  stripLeadingGreeting,
} from '../localization/localization';
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
  timezone: string;
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

const includesAny = (text: string, words: string[]): boolean => words.some((word) => text.includes(word));

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
        return this.offeringReply(client, message, intent, copy, bot.locale, bot.timezone);
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
    copy: {
      menuUnavailable: string; productQuestion: string; menuHeading: string; priceHeading: string; menuButtonLabel: string;
      menuCategoriesHeading: string; menuCategoryPrefix: string; menuUncategorized: string;
    },
    locale: ConversationLocale,
    timezone: string,
  ): Promise<DeterministicReply> {
    // Same time-window rule as CommercialFlowService.catalogItems() (D-097)
    // — an item outside its daily window (e.g. a lunch-only dish asked
    // about after lunch hours) is excluded from "ver menú" and price
    // lookups exactly the same as it is from the order flow, so a customer
    // can never see or get quoted something the kitchen isn't making right
    // now.
    const result = await client.query<OfferingRow>(
      `select item.id::text as item_id,variant.id::text as variant_id,
              coalesce(item_loc.name,item.name) as name,
              coalesce(cat_loc.label,item.category) as category,
              coalesce(variant_loc.name,variant.name) as variant_name,
              variant.price_minor::text,variant.currency
         from app.catalog_items item
         join app.item_variants variant on variant.tenant_id=item.tenant_id and variant.catalog_item_id=item.id
         left join app.catalog_item_localizations item_loc
           on item_loc.tenant_id=item.tenant_id and item_loc.catalog_item_id=item.id and item_loc.locale=$1
         left join app.item_variant_localizations variant_loc
           on variant_loc.tenant_id=variant.tenant_id and variant_loc.item_variant_id=variant.id and variant_loc.locale=$1
         left join app.catalog_category_localizations cat_loc
           on cat_loc.tenant_id=item.tenant_id and cat_loc.category=item.category and cat_loc.locale=$1
        where item.status='active' and item.customer_orderable and variant.status='active' and variant.availability_status='available'
          and variant.availability_status in ('available','unknown')
          and (item.available_from_time is null or item.available_until_time is null
               or (now() at time zone $2)::time between item.available_from_time and item.available_until_time)
        order by item.category,item.name,variant.price_minor`,
      [languageFor(locale), timezone],
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
      // A question about a whole category — "¿qué tacos tienen?", or the
      // "Menú Tacos" row of the category picker itself — must list that
      // category, not only the items that happen to repeat the category
      // word in their own name. Found live on Santos Tacos' real menu:
      // "Orden x 3 Tacos" and "Orden x 3 Tacos Birria de Camarón o
      // Güerito" scored 2 (own name *and* category) against 1 for every
      // individual taco, so 7 of the 9 tacos disappeared from the very
      // category the customer had just tapped. Only applies when the
      // message says nothing more specific than the category name: "¿tienen
      // tacos de birria?" still narrows to the birria items, because
      // "birria" matches an item name beyond the category's own words.
      const categoryWords = (value: string | null) =>
        normalize(value ?? '').split(' ').filter((token) => token.length > 2 && !ignored.has(token));
      const askedCategory = rows.find((row) => {
        const words = categoryWords(row.category);
        return words.length > 0 && words.every((word) => inputTokens.has(word));
      })?.category;
      const askedWords = new Set(categoryWords(askedCategory ?? null));
      const namedSomethingElse = rows.some((row) =>
        normalize(row.name)
          .split(' ')
          .some((token) => inputTokens.has(token) && !askedWords.has(token)),
      );
      const byCategory = askedCategory !== undefined && askedCategory !== null && !namedSomethingElse;
      const narrowed = byCategory || bestScore > 0;
      if (byCategory) rows = rows.filter((row) => row.category === askedCategory);
      else if (bestScore > 0) rows = scored.filter(({ score }) => score === bestScore).map(({ row }) => row);
      // A generic "ver menú" (no narrowing at all — the customer named
      // nothing specific) against a real catalog bigger than WhatsApp's
      // 10-row list cap used to fall all the way through to one plain-text
      // wall of every product, unbroken by category, with nothing tappable
      // — found live once Santos Tacos' real 41-item menu replaced the
      // small demo one (D-102). A category *was* already narrowable via
      // this same scoring (asking "¿qué tacos tienen?" scores every Tacos
      // item via its `category` field) — this just offers that path
      // up-front as a tappable list instead of requiring the customer to
      // already know to ask it that way. Only kicks in for the *unnarrowed*
      // case: once a category (or product) has already been picked, the
      // normal listing/plain-text fallback below runs exactly as before,
      // so tapping a category can never loop back into another category
      // picker.
      if (!narrowed && rows.length > 10) return this.menuCategoriesReply(rows, copy);
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
      // Same "no quoted instruction, real button instead" rule
      // commercial-flow.service.ts's catalogButtonReply already follows
      // (D-095) — this used to say '...también puedes escribir "ver
      // catálogo"' as plain quoted text.
      else
        return {
          intent,
          handoff: false,
          sources: [],
          body: copy.productQuestion,
          interactive: { type: 'buttons', body: '', options: [{ id: 'cart:view_catalog', title: copy.menuButtonLabel }] },
        };
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
    // Same escape-hatch reasoning as catalogChoiceReply (D-104): a narrowed
    // category can land on very few items (even just one), with nothing
    // tappable to back out of it. Reusing the exact same id/copy
    // (cart:view_catalog / menuButtonLabel) a bare "ver menú" already uses
    // means tapping it here just re-runs this same reply unnarrowed —
    // back to the category picker for a catalog over 10 items, or the full
    // flat list otherwise. Capped to 9 real rows so this extra one never
    // pushes a full list past WhatsApp's 10-row cap.
    const interactive: InteractiveMessage | undefined =
      intent === 'menu' && rowInfo.length > 0 && rowInfo.length <= 10
        ? {
            type: 'list',
            body: '',
            buttonLabel: copy.menuButtonLabel,
            options: [
              ...rowInfo.slice(0, 9).map(({ row, price, variantLabel }) => {
                const detail = variantLabel ? `${variantLabel} · ${price}` : price;
                return {
                  id: row.variant_id,
                  title: truncate(row.name, 24),
                  // Same rule as itemChoiceReply (D-101/D-102): a name too
                  // long for the 24-char title must not lose the words that
                  // tell it apart from a sibling row — "Sandwich de queso y
                  // Sop…" and "Sandwich de queso y bir…" are otherwise the
                  // same row to the customer. The description already
                  // carries variant/price, so the full name goes in front of
                  // it rather than replacing it.
                  description: truncate(
                    row.name.length > 24 ? `${row.name} · ${detail}` : detail,
                    72,
                  ),
                };
              }),
              { id: 'cart:view_catalog', title: copy.menuButtonLabel },
            ],
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
  // Each row's title carries copy.menuCategoryPrefix ("Menú") specifically
  // so a tap re-triggers the 'menu' intent when its title comes back as the
  // next inbound message (see classifyMessage's keyword list) — the
  // category name alone wouldn't necessarily match any fixed intent and
  // could fall through to unrelated FAQ matching instead. The category name
  // itself is what then narrows the *next* call to offeringReply via the
  // exact same name+category token scoring already used above, so no new
  // matching logic is needed for the second tap — it reuses the one this
  // file already had before this feature existed.
  //
  // Capped at 10 categories (WhatsApp's own list-row limit) — with more
  // than that, the smallest categories by item count are dropped from the
  // picker entirely rather than truncating a name or crashing. A genuine
  // gap for a tenant with more than 10 non-empty categories (Santos Tacos
  // currently has 11; only the smallest, "Flauta", is left out of the
  // picker) — a still-searchable product in a dropped category is never
  // fully unreachable (asking for it by name, or by a *different* category
  // question, still works), but browsing that one category via "ver menú"
  // isn't offered. Documented as a known limitation rather than solved with
  // fragile category-merging, which would risk breaking the scoring match
  // above if a merged label got truncated mid-name.
  private menuCategoriesReply(
    rows: OfferingRow[],
    copy: { menuCategoriesHeading: string; menuCategoryPrefix: string; menuUncategorized: string; menuButtonLabel: string },
  ): DeterministicReply {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const category = row.category ?? copy.menuUncategorized;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    // Sorted by item count purely to decide which categories survive the
    // 10-row cap (see the comment above) — never shown to the customer, per
    // the project owner's own call: "Ese 3 productos ... no debería salir".
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return {
      intent: 'menu',
      handoff: false,
      sources: [],
      body: copy.menuCategoriesHeading,
      interactive: {
        type: 'list',
        body: '',
        buttonLabel: copy.menuButtonLabel,
        options: top.map(([category]) => ({
          id: category,
          title: truncate(`${copy.menuCategoryPrefix} ${category}`, 24),
        })),
      },
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
