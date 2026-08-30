// Bundled high-frequency English vocabulary, used to decide which words in a
// selected sentence are worth defining.
//
// This is deliberately a static asset rather than an API call: deciding what is
// "hard" happens entirely on the user's machine, so selecting a paragraph never
// tells anyone which paragraph you selected. Only the handful of words that
// survive this filter are ever looked up.
//
// Roughly the thousand most common English word forms. Coverage matters more
// than precision here -- a word wrongly treated as common is one missing card,
// and a word wrongly treated as rare is one redundant card.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const COMMON = `
the be to of and a in that have i it for not on with he as you do at this but his
by from they we say her she or an will my one all would there their what so up out
if about who get which go me when make can like time no just him know take people
into year your good some could them see other than then now look only come its over
think also back after use two how our work first well way even new want because any
these give day most us is are was were been being has had did does said made
man men woman women child children thing things place places case cases part parts
group groups company companies problem problems fact facts point points government
number numbers night nights water form forms family families head heads hand hands
eye eyes face faces house houses home homes world worlds school schools state states
story stories life lives money name names line lines area areas book books car cars
city cities body bodies word words side sides business month months right lot lots
study studies job jobs issue issues kind kinds level levels war power powers member
members office offices door doors health art history party result change morning
reason research girl guy moment air teacher force education foot boy age policy
process music market sense nation plan college interest death experience effect
class control care field development role effort rate heart drug show leader light
voice wife police mind price report decision son view relationship town road arm
difficulty value building action model season society tax director position player
record paper space ground form event official matter center couple site end project
activity star table need court today war during without before under around among
be am is are was were been being become became becomes becoming
go goes going gone went come comes coming came take takes taking took taken
make makes making made get gets getting got gotten give gives giving gave given
know knows knowing knew known think thinks thinking thought see sees seeing saw seen
look looks looking looked want wants wanting wanted use uses using used
find finds finding found tell tells telling told ask asks asking asked
work works working worked seem seems seeming seemed feel feels feeling felt
try tries trying tried leave leaves leaving left call calls calling called
keep keeps keeping kept let lets letting begin begins beginning began begun
help helps helping helped talk talks talking talked turn turns turning turned
start starts starting started might show shows showing showed shown hear hears
play plays playing played run runs running ran move moves moving moved
live lives living lived believe believes believing believed hold holds holding held
bring brings bringing brought happen happens happening happened write writes writing
wrote written provide provides providing provided sit sits sitting sat
stand stands standing stood lose loses losing lost pay pays paying paid
meet meets meeting met include includes including included continue continues
set sets setting learn learns learning learned change changes changing changed
lead leads leading led understand understands understanding understood watch watches
follow follows following followed stop stops stopping stopped create creates creating
speak speaks speaking spoke spoken read reads reading allow allows allowing allowed
add adds adding added spend spends spending spent grow grows growing grew grown
open opens opening opened walk walks walking walked win wins winning won
offer offers offering offered remember remembers remembering remembered love loves
consider considers considering considered appear appears appearing appeared buy buys
wait waits waiting waited serve serves serving served die dies dying died
send sends sending sent build builds building built stay stays staying stayed
fall falls falling fell cut cuts cutting reach reaches reaching reached
kill kills killing killed remain remains remaining remained suggest suggests
raise raises raising raised pass passes passing passed sell sells selling sold
require requires requiring required report reports reporting reported decide decides
pull pulls pulling pulled return returns returning returned explain explains
hope hopes hoping hoped develop develops developing developed carry carries carrying
break breaks breaking broke broken receive receives receiving received agree agrees
support supports supporting supported hit hits hitting produce produces producing
eat eats eating ate eaten cover covers covering covered catch catches catching caught
draw draws drawing drew drawn choose chooses choosing chose chosen
good better best bad worse worst great little large small big high low long short
young old new early late important few public same able different next last
right left early hard easy free strong special clear recent certain personal
open red white black blue green real full sure simple close true whole major
common poor natural significant similar current local human local national social
economic political international physical financial available likely possible
i me my mine myself you your yours yourself he him his himself she her hers herself
it its itself we us our ours ourselves they them their theirs themselves
who whom whose which what where when why how there here this that these those
and or but so because although though while whereas unless until since if then
of in on at by for with about against between into through during before after
above below to from up down out off over under again further once here there
all any both each few more most other some such no nor not only own same
than too very just can will should now also however therefore thus hence
one two three four five six seven eight nine ten first second third
say says saying said get got give gave put puts putting mean means meaning meant
much many more less least often always never sometimes usually really quite
yes okay well maybe perhaps almost enough still yet even ever
thereby whereby hence thus therefore moreover furthermore however whereas
herein thereof therein hereby wherein accordingly consequently likewise
instead rather indeed besides otherwise meanwhile although despite unless
within without throughout toward towards upon along across behind beyond
`.trim().split(/\s+/);

  const COMMON_SET = new Set(COMMON);

  // Suffix stripping so "considering" is recognised via "consider" even when
  // the exact form is missing from the list above.
  function stems(word) {
    const w = word.toLowerCase();
    const out = [w];
    const add = (s) => { if (s.length >= 3) out.push(s); };
    if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (w.endsWith('s')) add(w.slice(0, -1));
    if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); }
    if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (w.endsWith('ly')) add(w.slice(0, -2));
    if (w.endsWith('er')) add(w.slice(0, -2));
    if (w.endsWith('est')) add(w.slice(0, -3));
    return out;
  }

  function isCommon(word) {
    return stems(word).some((s) => COMMON_SET.has(s));
  }

  // Higher means more likely to be worth defining. Length and morphology stand
  // in for the frequency data we deliberately do not ship.
  function rarity(word) {
    const w = String(word || '').toLowerCase();
    if (!w || isCommon(w)) return 0;
    let score = Math.min(10, w.length - 3);
    // Latin/Greek academic morphology is a strong marker of a hard word.
    if (/(tion|sion|ology|ism|itis|osis|ance|ence|ious|eous|ary|ative|escent|ify|graph|phobia|ectomy)$/.test(w)) score += 3;
    if (/^(anti|auto|counter|hyper|hypo|inter|intra|meta|micro|multi|neo|para|poly|pseudo|quasi|retro|semi|sub|supra|trans|ultra)/.test(w)) score += 2;
    if (w.length <= 4) score -= 2;
    return Math.max(0, score);
  }

  QL.freq = { isCommon, rarity, stems, size: COMMON_SET.size };
})();
