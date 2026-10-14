<!--
NOTE: Created by the article-pipeline scaffolding. Maps editorial quality
dimensions onto the pipeline's QA stages. Replace with the real checklist when
available.
-->

# Quality checklist

Dimensions checked per article (final status per dimension: PASS / NEEDS REVIEW / FAIL):

1. **Claims and sources** — every externally sourced factual claim carries a
   claim marker mapped to research claim IDs; every cited source ID exists in
   the research artifact; fetch evidence is stored.
2. **Placeholders** — no `[AUTHOR: ...]`, `[PLACEHOLDER]`, or unresolved
   navigation markers remain.
3. **Personal experience** — no "I tested / I measured" statements without an
   explicit author assertion plus evidence record.
4. **Code** — executable snippets carry run specs; executed bytes match the
   article by hash; failures and untested behaviors are reported.
5. **Diagrams** — all referenced diagrams exist and render; label
   inconsistencies are warnings.
6. **Metadata** — headline, subtitle, excerpt, tags, reading time present;
   platform limits carry verification metadata or are flagged unverified.
7. **Consistency** — version-sensitive claims carry qualifiers; no duplicate
   headings; no broken local artifact references.
8. **Voice** — phrase warnings are advisory only; they are never proof of AI
   authorship or technical inaccuracy.
