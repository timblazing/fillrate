// M2 design review questionnaire (spec §15 M2, §1 pending assumptions). Question ids are stored with the answers,
// so rename labels freely but never reuse an id for a different question.

import type { BlockId } from "../components/sections/blocks"

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
  questions: Question[]
}

export const reviewSections: ReviewSection[] = [
  {
    id: "workbench",
    title: "Workbench",
    block: "workbench",
    intro:
      "The main screen after a run: map of stops by cluster, a side panel for the selected cluster or truck, and Loads / Order lines / Unshipped along the bottom. Try clicking a cluster, a truck bar, and a stop.",
    questions: [
      {
        id: "workbench.first",
        kind: "single",
        prompt: "When a run finishes, what do you want to look at first?",
        options: [
          ["map", "The map of clusters"],
          ["loads", "The list of truck loads"],
          ["summary", "Summary numbers (trucks, fill, revenue)"],
          ["unshipped", "What didn't ship and why"],
        ],
      },
      {
        id: "workbench.trailer",
        kind: "single",
        prompt: "Each truck is drawn as a trailer bar: one segment per stop in visit order, hatched where the floor is empty. How does that read?",
        options: [
          ["clear", "Clear, I can see the load at a glance"],
          ["ok", "Readable, but a plain fill % would do"],
          ["confusing", "Confusing"],
        ],
      },
      {
        id: "workbench.low",
        kind: "single",
        prompt: "Trucks under 60% full are flagged amber under “Needs attention.” Where should that line be?",
        options: [
          ["50", "Under 50%"],
          ["60", "Under 60% (current)"],
          ["70", "Under 70%"],
          ["80", "Under 80%"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "orders",
    title: "Orders & inventory",
    block: "orders-inventory",
    intro: "What was imported: headline counts, where each address's coordinates came from, stock against demand, and every order line.",
    questions: [
      {
        id: "orders.coords",
        kind: "single",
        prompt: "The coordinate badges show how each address was placed (your file, Census match, ZIP approximate, manual, missing). How much do you care?",
        options: [
          ["always", "Always want to see it"],
          ["problems", "Only when something is approximate or missing"],
          ["never", "Don't care"],
        ],
      },
      {
        id: "orders.stock",
        kind: "multi",
        prompt: "For inventory coverage, what do you need to see per product?",
        options: [
          ["pieces", "Pieces on hand vs ordered"],
          ["short", "Pieces short"],
          ["amount", "Dollars short"],
          ["orders", "Which orders got shorted"],
          ["pct", "Fill rate %"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "run",
    title: "Run pipeline",
    block: "run-pipeline",
    intro:
      "The settings a run will use (and where each came from), warnings before it starts, and the steps as they run. Press Run pipeline in the header to watch it.",
    questions: [
      {
        id: "run.stages",
        kind: "single",
        prompt: "The step list (Allocate, Aggregate, Cluster, Solve, Validate…) is labeled “Pipeline detail.” How visible should it be?",
        options: [
          ["show", "Show it, I like seeing each step"],
          ["collapse", "Collapse it; show just progress and the result"],
          ["hide", "Hide it"],
        ],
      },
      {
        id: "run.block",
        kind: "multi",
        prompt: "Which pre-run warnings should stop a run until you fix them? Unticked ones only warn.",
        options: [
          ["missing", "Addresses with no coordinates"],
          ["zip", "Addresses placed by ZIP only"],
          ["far", "Stops farther than 500 mi from the depot"],
          ["oversize", "A stop bigger than one trailer (gets split)"],
          ["none", "None; warn me and run anyway"],
        ],
      },
    ],
  },
  {
    id: "results",
    title: "Results",
    block: "results",
    intro:
      "The run report: the flow from orders to shipped, three metric groups, cluster cards with their trucks, unshipped lines with reasons, and the map.",
    questions: [
      {
        id: "results.flow",
        kind: "single",
        prompt: "Does the strip across the top (Orders → Allocated → Stops → Clusters → Trucks → Shipped, with what dropped out at each step) tell you what happened?",
        options: [
          ["yes", "Yes, that's the summary I want"],
          ["mostly", "Mostly, with changes"],
          ["no", "No, I'd rather see something else"],
        ],
      },
      {
        id: "results.judge",
        kind: "single",
        prompt: "When judging a run, which matters most?",
        options: [
          ["fill", "Truck fill"],
          ["trucks", "Number of trucks"],
          ["tight", "Tight clusters / fewer miles"],
          ["revenue", "Revenue shipped"],
        ],
      },
      {
        id: "results.reasons",
        kind: "multi",
        prompt: "Unshipped lines are grouped by reason. Which of these would you actually see in your work?",
        options: [
          ["no-stock", "No stock"],
          ["leg", "Beyond the 500 mi leg limit"],
          ["fit", "Did not fit on a truck"],
          ["data", "Bad or missing address data"],
        ],
        other: true,
      },
      {
        id: "results.load-sheet",
        kind: "multi",
        prompt: "For one truck's load, what do you need to see or print?",
        options: [
          ["sequence", "Stop order"],
          ["address", "Delivery addresses"],
          ["orders", "Order numbers"],
          ["pieces", "Pieces per product"],
          ["lf", "Linear feet per stop"],
          ["miles", "Miles between stops"],
          ["value", "Dollar value"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "k",
    title: "k explorer",
    block: "k-explorer",
    intro:
      "Clustering only, no trucks: tries a range of cluster counts (k) and ten k-means seeds, and shows how much the grouping changes between seeds. The map colors stops that switch clusters between seeds in red.",
    questions: [
      {
        id: "k.today",
        kind: "single",
        prompt: "How do you pick the number of clusters today?",
        options: [
          ["fixed", "Same number every time"],
          ["trial", "Trial and error until it looks right"],
          ["rule", "A rule of thumb (e.g. trucks ÷ something)"],
          ["region", "By region or territory"],
        ],
        other: true,
      },
      {
        id: "k.stability",
        kind: "single",
        prompt: "“Stability” means how often different seeds give the same grouping. Does that match what you check for?",
        options: [
          ["yes", "Yes, that's exactly it"],
          ["partly", "Partly"],
          ["no", "No, I look at something else"],
        ],
      },
    ],
  },
  {
    id: "compare",
    title: "Iteration comparison",
    block: "comparison",
    intro: "A sweep of nine runs with different settings. Tick two rows to compare them side by side with the difference in each metric and the settings that changed.",
    questions: [
      {
        id: "compare.vary",
        kind: "multi",
        prompt: "What do you change between versions?",
        options: [
          ["k", "Number of clusters"],
          ["seed", "Seed / rerun"],
          ["inventory", "Inventory available"],
          ["orders", "Which orders are included"],
          ["rule", "Allocation rule"],
          ["miles", "Mileage cushion or 500 mi limit"],
        ],
        other: true,
      },
      {
        id: "compare.star",
        kind: "single",
        prompt: "The ★ marks runs that no other run beats on every metric. What should it be called?",
        options: [
          ["nondominated", "“Non-dominated” is fine"],
          ["best", "“Best trade-off”"],
          ["contender", "“Contender”"],
          ["drop", "Don't need it"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "words",
    title: "Wording",
    intro: "We tried to use the words logistics planning tools use. Pick what you'd say at work.",
    questions: [
      {
        id: "words.cluster",
        kind: "single",
        prompt: "A group of nearby stops that trucks are built from:",
        options: [
          ["cluster", "Cluster"],
          ["zone", "Zone"],
          ["region", "Region"],
          ["lane", "Lane"],
        ],
        other: true,
      },
      {
        id: "words.truck",
        kind: "single",
        prompt: "One truck with its stops and the order lines on it:",
        options: [
          ["truck", "Truck"],
          ["load", "Load"],
          ["route", "Route"],
          ["shipment", "Shipment"],
        ],
        other: true,
      },
      {
        id: "words.unshipped",
        kind: "single",
        prompt: "Ordered pieces that don't go out in this plan:",
        options: [
          ["unshipped", "Unshipped"],
          ["short", "Shorted"],
          ["backorder", "Backordered"],
          ["unplanned", "Unplanned"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "rules",
    title: "Planning rules",
    intro: "A few rules we assumed and want to confirm before building the real thing.",
    questions: [
      {
        id: "rules.tiebreak",
        kind: "single",
        prompt: "When two orders have the same order date and stock is short, which should get stock first?",
        options: [
          ["piece", "Higher value per piece"],
          ["line", "Higher line total"],
          ["order", "Higher order total"],
          ["customer", "A customer priority"],
        ],
        other: true,
      },
      {
        id: "rules.combine",
        kind: "single",
        prompt: "Several orders going to the same address: one stop or separate stops?",
        options: [
          ["always", "Always one stop"],
          ["same-customer", "One stop only if same customer"],
          ["never", "Always separate"],
        ],
        other: true,
      },
      {
        id: "rules.objective",
        kind: "single",
        prompt: "If one plan uses fewer trucks and another uses fewer miles, which wins?",
        options: [
          ["trucks", "Fewer trucks, then fewer miles"],
          ["miles", "Fewer miles, even if it takes an extra truck"],
          ["cost", "Whichever costs less (tell us truck vs mile cost)"],
        ],
        other: true,
      },
      {
        id: "rules.500",
        kind: "multi",
        prompt: "What does the 500-mile rule cover?",
        help: "Tick all that apply.",
        options: [
          ["leg", "Each drive between two stops (and depot → first stop)"],
          ["cluster", "Farthest two stops in a cluster"],
          ["depot", "Every stop within 500 mi of the depot"],
          ["route", "Total route miles"],
        ],
        other: true,
      },
    ],
  },
  {
    id: "data",
    title: "Your data",
    intro: "Optional. To build the import, we need to know what your order and inventory files look like. Fake values are fine; the column names are what matter.",
    questions: [
      {
        id: "data.orders",
        kind: "text",
        long: true,
        prompt: "Paste a header row and 2–3 example order rows (fake values)",
        placeholder: "order_id,order_date,customer,address,zip,product,pieces,net_price,lf_per_piece\n…",
      },
      {
        id: "data.inventory",
        kind: "text",
        long: true,
        prompt: "Same for inventory",
        placeholder: "product,on_hand\n…",
      },
    ],
  },
  {
    id: "overall",
    title: "Overall",
    intro: "Last one.",
    questions: [
      { id: "overall.fix", kind: "text", long: true, prompt: "What should we fix or add first? Anything else on your mind goes here too." },
    ],
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
