// M2 design review, round two (spec v1.8 §15 M2 item 17). Round one's answers are stored and exported as-is in
// docs/reviews/fillrate-design-review-2026-09-30.json; its ids (workbench.first, orders.coords, …) are retired.
// Question ids are stored with the answers, so rename labels freely but never reuse an id for a different question.
// Every round-two id starts with "r2.".

import type { BlockId } from "../components/sections/blocks"

export const REVIEW_ROUND = 2

export type Choice = [value: string, label: string]

export type Question =
  | { id: string; kind: "single"; prompt: string; help?: string; options: Choice[]; other?: boolean }
  | { id: string; kind: "multi"; prompt: string; help?: string; options: Choice[]; other?: boolean }
  | { id: string; kind: "text"; prompt: string; help?: string; placeholder?: string; long?: boolean }

export type ReviewSection = {
  id: string
  title: string
  intro: string
  /** Gallery block shown above the questions. */
  block?: BlockId
  /** A real page to open instead of (or beside) a block. */
  link?: { href: string; label: string }
  questions: Question[]
}

const accept = (id: string, what: string): Question => ({
  id,
  kind: "single",
  prompt: `Does the revised ${what} look right?`,
  options: [
    ["accept", "Yes, accept it"],
    ["minor", "Mostly; small changes (say which below)"],
  ],
  other: true,
})

const changes = (id: string): Question => ({ id, kind: "text", long: true, prompt: "What would you change? (optional)" })

export const reviewSections: ReviewSection[] = [
  {
    id: "you",
    title: "Round two",
    intro:
      "Thanks for round one. Everything you answered is now in the screens: Shipments instead of loads, map first, fill % with an 80% low-fill line, coordinate badges only for problems, pieces short / fill rate / shorted orders for stock, Steps always visible, three checks that block a run, revenue first, and a printable shipment sheet. This round is short: accept or change each screen, plus the few things still open.",
    questions: [{ id: "r2.you.name", kind: "text", prompt: "Your name", placeholder: "So we know whose answers these are" }],
  },
  {
    id: "workbench",
    title: "Workbench",
    block: "workbench",
    intro: "Map first. The Shipments tab lists each shipment with its fill %; the trailer drawing moved to the shipment detail. Amber means under 80%.",
    questions: [accept("r2.workbench.accept", "workbench"), changes("r2.workbench.change")],
  },
  {
    id: "orders",
    title: "Orders & inventory",
    block: "orders-inventory",
    intro:
      "Coordinate badges now appear only for ZIP-approximate or missing addresses (use “Show all sources” for the rest, or “Coordinate problems” to filter). Stock shows pieces short, fill rate % and which orders were shorted; on hand vs ordered and dollars short are behind the ⓘ button.",
    questions: [accept("r2.orders.accept", "orders and stock screen"), changes("r2.orders.change")],
  },
  {
    id: "run",
    title: "Run pipeline",
    block: "run-pipeline",
    intro:
      "Three checks now block Run pipeline: no coordinates, farther than 500 mi from the depot, and a stop larger than one trailer. Each offers: fix the data, exclude those lines and run, or turn the check into a warning. Steps stay open. The Fleet and constraints box has cost per truck and per mile.",
    questions: [
      accept("r2.run.accept", "run screen"),
      changes("r2.run.change"),
      {
        id: "r2.rules.far-via",
        kind: "single",
        prompt: "A stop 594 mi from the depot can still be reached by driving 396 mi to another stop, then 198 mi on. Should it still block the run?",
        help: "Every single drive is under 500 mi, so the solver can ship it.",
        options: [
          ["block", "Yes, block it: I don't want stops that far out"],
          ["warn", "No, warn me but plan it if a route exists"],
          ["allow", "No, don't even warn"],
        ],
      },
      {
        id: "r2.rules.oversize",
        kind: "single",
        prompt: "A stop orders more than one trailer holds. Should that block the run, or just split it across shipments?",
        options: [
          ["block", "Block it until I deal with it"],
          ["split", "Split it across shipments and tell me"],
          ["split-quiet", "Split it, no need to tell me"],
        ],
      },
    ],
  },
  {
    id: "results",
    title: "Results",
    block: "results",
    intro: "Revenue leads, then trailer fill, then tightness. The map is the first tab. Shipment sheets print one shipment per page.",
    questions: [
      accept("r2.results.accept", "results screen"),
      changes("r2.results.change"),
      {
        id: "r2.results.flow",
        kind: "single",
        prompt: "The strip across the top (Orders → Allocated → Stops → Clusters → Shipments → Shipped): last time you said “mostly, with changes.” What would you change?",
        options: [
          ["keep", "Nothing, keep it"],
          ["fewer", "Fewer steps (say which below)"],
          ["numbers", "Different numbers in it (say which below)"],
        ],
        other: true,
      },
      { id: "r2.results.flow-detail", kind: "text", prompt: "Details for the strip (optional)" },
      {
        id: "r2.fill.full",
        kind: "single",
        prompt: "Shipments at 90% fill or more show green as “full.” Is 90% the right line?",
        options: [
          ["85", "85%"],
          ["90", "90% (current)"],
          ["95", "95%"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "sheet",
    title: "Shipment sheet",
    link: { href: "/runs", label: "Open a run, then Shipment sheets" },
    intro:
      "Per stop in visit order: sequence, order numbers, linear feet, miles from the previous stop (the depot for stop 1) and dollar value, with totals. Location and pieces per product are optional columns. Print or download the CSV.",
    questions: [accept("r2.sheet.accept", "shipment sheet"), changes("r2.sheet.change")],
  },
  {
    id: "k",
    title: "k explorer",
    block: "k-explorer",
    intro: "Unchanged except for “Use this k”, which carries k and the seed into the run settings. Since the 500 mi rule is per drive only, fixed k from here is the normal way to pick clusters.",
    questions: [accept("r2.k.accept", "k explorer")],
  },
  {
    id: "compare",
    title: "Iteration comparison",
    block: "comparison",
    intro: "Sorted by planned revenue. k, seed, inventory available and mileage lead; inventory and mileage changes are marked “changed assumption”.",
    questions: [
      accept("r2.compare.accept", "comparison screen"),
      {
        id: "r2.compare.star",
        kind: "single",
        prompt: "The ★ marks runs no other run beats on all three of revenue, fill and tightness. What should that be called?",
        options: [
          ["non-dominated", "Non-dominated"],
          ["best-tradeoff", "Best trade-off"],
          ["contender", "Contender"],
          ["none", "Drop the star"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "cost",
    title: "Costs",
    intro: "You chose “whichever plan costs less.” Plans can only be compared on cost with these two numbers. Rough is fine.",
    questions: [
      { id: "r2.cost.truck", kind: "text", prompt: "Cost per truck (dollars per shipment)", placeholder: "e.g. 450" },
      { id: "r2.cost.mile", kind: "text", prompt: "Cost per mile (dollars per loaded mile)", placeholder: "e.g. 2.35" },
    ],
  },
  {
    id: "data",
    title: "Example rows",
    intro: "A few made-up rows in your usual layout so the import (next milestone) matches your files. Fake values are fine.",
    questions: [
      { id: "r2.data.orders", kind: "text", long: true, prompt: "A few order rows, with your column names", placeholder: "order,customer,address,zip,order_date,sku,qty,net_value\n…" },
      { id: "r2.data.inventory", kind: "text", long: true, prompt: "A few inventory rows", placeholder: "sku,on_hand\n…" },
    ],
  },
  {
    id: "overall",
    title: "Overall",
    intro: "Last one.",
    questions: [{ id: "r2.overall.fix", kind: "text", long: true, prompt: "What should we fix or add first? Anything else goes here too." }],
  },
]

export const allQuestions = reviewSections.flatMap((s) => s.questions)

export type Answer = string | string[]
export type Answers = Record<string, Answer>

export const OTHER = "__other"
/** Free-text "Other" answers are stored under `<question id>.other`. */
export const otherKey = (id: string) => `${id}.other`

export function isAnswered(a: Answer | undefined) {
  return Array.isArray(a) ? a.length > 0 : !!a?.trim()
}
