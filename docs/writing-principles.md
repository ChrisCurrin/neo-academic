# Writing principles for NEO papers

For people and agents building academic features in NEO. It distils the
writing workshop Christopher Currin gave at AIMS 2026 into rules a feature
can be checked against. Read it alongside the Papers section of
[AGENTS.md](../AGENTS.md), which covers how the code works. This file
covers what the code is for.

## 1. A paper is a story told under constraints

A submission gives a writer a handful of fixed spaces. Each one is an
opportunity with its own job:

| Space | Its job | Typical limit |
|---|---|---|
| Title | Interest people | ~100 characters |
| Abstract or summary | Get visitors and feedback: the primary findings, why they matter, how general and new they are | 150–300 words |
| The paper | Convince reviewers: the question, the approach, the results, the conclusions, with figures and equations where they help | a few pages |

Reviewers judge four things (NeurIPS's wording is typical):

- **Quality:** sound, well-supported claims, honest about weaknesses.
- **Clarity:** organised, and enough detail for an expert to reproduce it.
- **Significance:** others will use or build on it.
- **Originality:** new insight, clearly distinct from earlier work.

Originality need not mean a new method. A new evaluation, or a new
combination with its reasoning made explicit, counts too.

**For features:** show writers the limit of each space while they work
in it, quietly. The abstract's word count and the title's length are
examples. Name the space's job wherever NEO prompts for it.

## 2. A story sets expectations and gives context

Science supplies the content; story supplies the *why*. Readers follow an
argument when they know what to expect next. A paper follows the hero's
journey:

| The journey | The paper |
|---|---|
| Ordinary world, call to adventure | Introduction |
| Meeting the mentor, crossing the threshold | Methods |
| Tests, the ordeal, the reward | Results |
| The road back, resurrection | Discussion |
| Return with the elixir | Conclusion |

**For features:** whatever NEO generates or suggests should tell the
reader what comes next before it comes. Numbered headings, cross-references
that name what they point to ("Figure 2", not "this figure") and the
section scaffold all do this.

## 3. The same shape at every scale

Humans are forgetful and need the important lessons more than once, so
the same rhythm repeats at every level:

- **Thesis → paper:** a thesis is papers. A paper is Introduction
  *[why, who, when]*, Methods *[how, where]*, Results *[what, how]* and
  Conclusions *[why]*.
- **Abstract → paper:** the abstract is the paper in miniature, and each
  of its moves previews a section:

  | Abstract move | Previews |
  |---|---|
  | Topic | Title |
  | Status quo | Introduction |
  | Problem with the status quo | Introduction |
  | How to solve it, in general | Introduction |
  | What we did | Methods |
  | What we found | Results |
  | Context and impact | Conclusions |

- **Paragraph:**
  - *Context:* what has been established (often the paragraph before),
    and a hint of what this paragraph adds.
  - *Content.*
  - *Conclude:* gather what it said, form a small conclusion, and point
    to what comes next.

**For features:** use this vocabulary and these mappings everywhere NEO
guides structure: the abstract guide, the section scaffold, and anything
added later. A writer should meet one model of a paper, not several.

## 4. Themes and variations

- **Repetition** makes text easy to take in: the same term for the same
  thing, the same order for parallel results, the same form for every
  figure caption.
- **Subversion** works only when it's obviously deliberate: consistent,
  explicit, rare. Otherwise it reads as a mistake.
- **Readability:** text should be optimised for information transfer and
  as easy to read as possible, *but not more so*. Don't simplify away
  precision.

**For features:** consistency is NEO's job, not the writer's. Numbering,
cross-reference labels, citation formatting and caption style come from
one place and can't drift. Anything a writer sets once (a citation style,
numbered headings, a journal) applies everywhere at once.

## 5. Planning, writing and editing are separate modes

Don't switch between them too often, and spend as much time editing as
writing ("write without fear, edit without mercy").

Feedback has levels too, and a writer should say which one they want:

- **Top-level:** the idea is good and suitable; the concept is
  self-consistent and logical.
- **Coarse-grained:** the style suits the venue; every paragraph is there
  for a reason and talks to the others; *what can be taken away? what
  should be added?*
- **Fine-grained:** spelling and grammar, personal preferences, and
  consistency of style.

**For features:** this is NEO's founding rule seen from the writer's
side. **Nothing interrupts writing.**

- **Planning help** (outlines, scaffolds, guides) shows on empty space
  and steps back once words arrive.
- **Writing help** is invisible: `$` becomes maths and `@` cites.
- **Editing help** (spellcheck, any future style pass) runs only when the
  writer asks for a pass, never as squiggles while typing.

A feature that mixes modes, such as a style warning that appears
mid-sentence, breaks this.

## 6. Language rules worth checking for

These are what an on-demand editing pass could look for. None of them
should be enforced while the writer types.

- Cut filler: *in order to* → *to*.
- Simple, clear, unambiguous.
- Stuck on a sentence? Delete it and write it again.
- Commas first, then check whether two sentences are clearer.
- When comparing, say so early and make the type of comparison explicit.
- Active over passive: *We show that…* over *It is shown that…*

## 7. How NEO applies this now

| Principle | Where |
|---|---|
| Constraints as opportunities | The title, abstract and main text counted against the journal's usual limits (`limits` in `paper/journals.js`), shown beside each count and in the section pane |
| Abstract mirrors the paper | The abstract guide: six moves in the colours of the sections they preview (`ABSTRACT_MOVES` in `paper/paper.js`), each ticked off quietly once a sentence makes it (`MOVE_CUES`) |
| Same shape at every scale | A new paper starts with Introduction, Methods, Results and Discussion, then the back matter journals ask for (Acknowledgements, Data availability, Author contributions, Competing interests, unnumbered); an empty section shows what it answers and the paragraph rhythm |
| Consistency is NEO's job | Numbering, cross-references (down to a panel: Figure 2b), citation style and journal layout each come from one setting |
| Separate modes | Guides appear only on empty space; spellcheck runs only as a pass; previews and exports are separate from the page, and the preview keeps up without taking the focus |
| Feedback at a level | File → Draft for Feedback asks for top-level, coarse-grained or fine-grained feedback, and the draft opens with that request and its questions |
| Set expectations for reviewers | Journal previews show the paper laid out as a journal would print it before it's sent |

## 8. Not built yet (in order of value)

1. **An editing pass for the language rules in section 6**, run like the
   spellcheck pass: filler phrases, passive constructions, and
   comparisons without a stated basis, each flagged with the rule it
   breaks.
2. **A paragraph check:** does each paragraph open with context and close
   with a conclusion? Shown as an outline of each paragraph's first and
   last sentences, so gaps in the rhythm are visible at a glance.
3. **From paper to talk:** a slide outline drawn from the paper. The
   abstract moves become the narrative; figure captions become slide
   titles that ask a question, each with one main result.
