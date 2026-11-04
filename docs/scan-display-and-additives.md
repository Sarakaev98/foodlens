# Scan display and additive identity

Original ingredients stay in the printed language. Optional English display data comes from the same photo analysis or validated Open Food Facts `ingredients_text_en`; missing translations use the existing batched translator. Fireworks translation keeps its 60-second deadline and bounded in-memory cache.

Optional web enrichment has a shared five-second budget. Complete OFF core/risk nutrients plus composition skip web work even when fiber is absent. Unknown source values remain unknown; the existing nutrition estimator separately labels estimates. Cancellation reaches search, page reading and AI extraction.

Additive identity is normalized before display and score calculation. Exact Russian/English aliases currently cover E270/lactic acid, E160a/carotenes, E330/citric acid, E322/lecithin and E202/potassium sorbate. Functional categories and mixtures are not mapped to invented codes. A name alone never acquires an E-code; only a printed/source code can supply it. Combined records retain `sourceMentions` with their original code, name and provenance, and original ingredients remain unchanged.

The Calve mayonnaise case contains four identified E-codes plus one unnamed flavouring declaration, rather than seven distinct additive records. This describes five declared positions, not necessarily five chemical substances. Product Score and Goal Match formulas are unchanged. The count penalty is already capped at five in this case, so removing the two duplicate records leaves its score unchanged.

Lactic acid does not infer Milk from the Russian adjective; independently stated milk ingredients and confirmed source allergens remain. Existing results without these optional metadata fields stay compatible. In-memory caches reset on API restart; existing mobile result objects do not update automatically.
