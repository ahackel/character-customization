// Localisation for the wardrobe. English is the source; every other language must supply the
// same keys, which the compiler checks. Item names come from the model in English, so other
// languages carry a name per catalogue id and fall back to the English one for anything new.

export type Lang = 'en' | 'de';
export const LANGS: { id: Lang; label: string; name: string }[] = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'de', label: 'DE', name: 'Deutsch' },
];

const en = {
  'title': 'Castaway Wardrobe',
  'home': 'All tools',
  'lede': 'Dress a small pixel person, then decide how long they have been on the island and how they feel. Everything is drawn once and follows the body in every action, facing and condition.',
  'shuffle': 'Shuffle',
  'reset': 'Start over',
  'saved': 'Saved characters',
  'saved.pick': 'Saved character',
  'saved.none': 'Not saved yet',
  'saved.save': 'Save',
  'saved.saveAs': 'Save as new',
  'saved.delete': 'Delete',
  'saved.export': 'Export',
  'saved.import': 'Import',
  'saved.name': 'Name for this character',
  'saved.default': 'Castaway',
  'saved.confirmDelete': 'Delete “{name}”? This cannot be undone.',
  'saved.ok': 'Saved “{name}”.',
  'saved.fail': 'This browser refused to save. Export the character to keep it.',
  'saved.badFile': 'That file is not a character.',
  'saved.imported': 'Imported “{name}”.',
  'language': 'Language',
  'preview': 'Preview',
  'wardrobe': 'Wardrobe',
  'sections': 'Wardrobe sections',

  'facing': 'Facing',
  'facing.to': 'Face {name}',
  'facing.0': 'front right',
  'facing.1': 'front left',
  'facing.2': 'back left',
  'facing.3': 'back right',

  'action': 'Action',
  'clip.idle': 'Idle',
  'clip.walk': 'Walk',
  'clip.run': 'Run',
  'clip.wave': 'Wave',
  'clip.use': 'Use',

  'ground': 'Ground',
  'ground.sand': 'Sand',
  'ground.grass': 'Grass',
  'ground.deck': 'Deck',
  'ground.shallows': 'Shallows',

  'wear': 'Condition',
  'wear.0': 'Neat',
  'wear.1': 'Worn',
  'wear.2': 'Ragged',
  'wear.3': 'Tattered',

  'mood': 'Mood',
  'mood.neutral': 'Neutral',
  'mood.smile': 'Smiling',
  'mood.happy': 'Happy',
  'mood.laughing': 'Laughing',
  'mood.sad': 'Sad',
  'mood.angry': 'Angry',
  'mood.surprised': 'Surprised',

  'tab.body': 'Body',
  'tab.face': 'Face',
  'tab.hair': 'Hair',
  'tab.beard': 'Beard',
  'tab.hat': 'Hat',
  'tab.top': 'Top',
  'tab.bottom': 'Bottom',
  'tab.shoes': 'Shoes',
  'tab.tool': 'In hand',

  'gender': 'Gender',
  'gender.m': 'Male',
  'gender.f': 'Female',
  'skin': 'Skin',
  'build': 'Build',
  'build.thin': 'Very slim',
  'build.slim': 'Slim',
  'build.sturdy': 'Sturdy',

  'eyes': 'Eyes',
  'eyes.round': 'Round',
  'eyes.small': 'Small',
  'eyes.wide': 'Wide',
  'eyes.sleepy': 'Sleepy',
  'eyeColor': 'Eye colour',
  'eyeColor.dark': 'Dark',
  'brows': 'Brows',
  'brows.none': 'None',
  'brows.thin': 'Thin',
  'brows.thick': 'Thick',
  'details': 'Details',
  'blush': 'Blush',
  'freckles': 'Freckles',
  'lashes': 'Lashes',
  'glasses': 'Glasses',
  'glassesColor': 'Glasses colour',

  'hair.bald': 'Bald',
  'hair.short': 'Short and unruly',
  'hair.long': 'Long',
  'hairColor': 'Hair colour',
  'hair.note': 'Under a hat that covers the crown, hair is tucked in automatically. The longer someone has been on the island, the longer and wilder it grows.',

  'none': 'None',
  'undershorts': 'Undershorts',
  'color.main': 'Main colour',
  'color.second': 'Second colour',
  'color.original': 'Original',
  'beard.note': 'A beard takes the hair colour. Change it under Hair.',

  'foot.items': 'The {count} items here were written by a language model from one-line requests and are shown as returned: {paint} painted over the whole sprite, {recipe} as recipes or small stamps. Each is drawn once, in neat condition.',
  'foot.rules': 'Rules do the rest. The condition ages clothing, shoes, hats and hair, so no item needs a ragged version. A beard seen from behind is worked out from its front view, hair tucks under hats, clothing follows the build, hair and beards take the hair colour, and colours can be swapped.',
  'foot.base': 'The body, faces, builds and the first two hairstyles are drawn by rule from parts written by the model and corrected by looking at the result.',

  'palette.skinA': 'Fair', 'palette.skinB': 'Light', 'palette.skinC': 'Tan', 'palette.skinD': 'Brown', 'palette.skinE': 'Dark',
  'palette.hairBlack': 'Black', 'palette.hairBrown': 'Brown', 'palette.hairBlond': 'Blond', 'palette.hairRed': 'Red', 'palette.hairGrey': 'Grey',
  'palette.white': 'White', 'palette.cream': 'Cream', 'palette.red': 'Red', 'palette.orange': 'Orange', 'palette.yellow': 'Yellow',
  'palette.leaf': 'Leaf green', 'palette.green': 'Green', 'palette.teal': 'Teal', 'palette.blue': 'Blue', 'palette.navy': 'Navy',
  'palette.purple': 'Purple', 'palette.pink': 'Pink', 'palette.brown': 'Brown', 'palette.tan': 'Tan', 'palette.straw': 'Straw',
  'palette.wood': 'Wood', 'palette.grey': 'Grey', 'palette.steel': 'Steel', 'palette.black': 'Black',
} as const;

export type Key = keyof typeof en;

const de: Record<Key, string> = {
  'title': 'Garderobe der Gestrandeten',
  'home': 'Alle Werkzeuge',
  'lede': 'Kleide eine kleine Pixelfigur ein und lege fest, wie lange sie schon auf der Insel ist und wie sie sich fühlt. Alles wird nur einmal gezeichnet und folgt dem Körper in jeder Aktion, Blickrichtung und jedem Zustand.',
  'shuffle': 'Zufall',
  'reset': 'Neu beginnen',
  'saved': 'Gespeicherte Figuren',
  'saved.pick': 'Gespeicherte Figur',
  'saved.none': 'Noch nicht gespeichert',
  'saved.save': 'Speichern',
  'saved.saveAs': 'Als neue speichern',
  'saved.delete': 'Löschen',
  'saved.export': 'Exportieren',
  'saved.import': 'Importieren',
  'saved.name': 'Name für diese Figur',
  'saved.default': 'Gestrandete',
  'saved.confirmDelete': '„{name}“ löschen? Das lässt sich nicht rückgängig machen.',
  'saved.ok': '„{name}“ gespeichert.',
  'saved.fail': 'Dieser Browser hat das Speichern verweigert. Exportiere die Figur, um sie zu behalten.',
  'saved.badFile': 'Diese Datei ist keine Figur.',
  'saved.imported': '„{name}“ importiert.',
  'language': 'Sprache',
  'preview': 'Vorschau',
  'wardrobe': 'Garderobe',
  'sections': 'Bereiche der Garderobe',

  'facing': 'Blickrichtung',
  'facing.to': 'Blick nach {name}',
  'facing.0': 'vorne rechts',
  'facing.1': 'vorne links',
  'facing.2': 'hinten links',
  'facing.3': 'hinten rechts',

  'action': 'Aktion',
  'clip.idle': 'Stehen',
  'clip.walk': 'Gehen',
  'clip.run': 'Rennen',
  'clip.wave': 'Winken',
  'clip.use': 'Benutzen',

  'ground': 'Boden',
  'ground.sand': 'Sand',
  'ground.grass': 'Gras',
  'ground.deck': 'Deck',
  'ground.shallows': 'Flachwasser',

  'wear': 'Zustand',
  'wear.0': 'Gepflegt',
  'wear.1': 'Abgetragen',
  'wear.2': 'Zerlumpt',
  'wear.3': 'Zerfetzt',

  'mood': 'Stimmung',
  'mood.neutral': 'Neutral',
  'mood.smile': 'Lächelnd',
  'mood.happy': 'Fröhlich',
  'mood.laughing': 'Lachend',
  'mood.sad': 'Traurig',
  'mood.angry': 'Wütend',
  'mood.surprised': 'Überrascht',

  'tab.body': 'Körper',
  'tab.face': 'Gesicht',
  'tab.hair': 'Haare',
  'tab.beard': 'Bart',
  'tab.hat': 'Hut',
  'tab.top': 'Oberteil',
  'tab.bottom': 'Unterteil',
  'tab.shoes': 'Schuhe',
  'tab.tool': 'In der Hand',

  'gender': 'Geschlecht',
  'gender.m': 'Männlich',
  'gender.f': 'Weiblich',
  'skin': 'Haut',
  'build': 'Statur',
  'build.thin': 'Sehr schlank',
  'build.slim': 'Schlank',
  'build.sturdy': 'Kräftig',

  'eyes': 'Augen',
  'eyes.round': 'Rund',
  'eyes.small': 'Klein',
  'eyes.wide': 'Groß',
  'eyes.sleepy': 'Müde',
  'eyeColor': 'Augenfarbe',
  'eyeColor.dark': 'Dunkel',
  'brows': 'Augenbrauen',
  'brows.none': 'Keine',
  'brows.thin': 'Dünn',
  'brows.thick': 'Dick',
  'details': 'Details',
  'blush': 'Wangenrot',
  'freckles': 'Sommersprossen',
  'lashes': 'Wimpern',
  'glasses': 'Brille',
  'glassesColor': 'Brillenfarbe',

  'hair.bald': 'Glatze',
  'hair.short': 'Kurz und zerzaust',
  'hair.long': 'Lang',
  'hairColor': 'Haarfarbe',
  'hair.note': 'Unter einem Hut, der den Scheitel bedeckt, werden die Haare automatisch darunter gesteckt. Je länger jemand auf der Insel ist, desto länger und wilder wachsen sie.',

  'none': 'Nichts',
  'undershorts': 'Unterhose',
  'color.main': 'Hauptfarbe',
  'color.second': 'Zweite Farbe',
  'color.original': 'Original',
  'beard.note': 'Ein Bart übernimmt die Haarfarbe. Sie lässt sich unter „Haare“ ändern.',

  'foot.items': 'Die {count} Teile hier wurden von einem Sprachmodell aus einzeiligen Beschreibungen geschrieben und werden unverändert gezeigt: {paint} über die ganze Figur gemalt, {recipe} als Rezepte oder kleine Stempel. Jedes ist nur einmal gezeichnet, in gepflegtem Zustand.',
  'foot.rules': 'Den Rest erledigen Regeln. Der Zustand lässt Kleidung, Schuhe, Hüte und Haare altern, sodass kein Teil eine zerlumpte Fassung braucht. Die Rückansicht eines Bartes wird aus der Vorderansicht abgeleitet, Haare verschwinden unter Hüten, Kleidung passt sich der Statur an, Haare und Bärte übernehmen die Haarfarbe, und Farben lassen sich tauschen.',
  'foot.base': 'Körper, Gesichter, Staturen und die ersten beiden Frisuren werden nach Regeln aus Teilen gezeichnet, die das Modell geschrieben hat und die anhand des Ergebnisses korrigiert wurden.',

  'palette.skinA': 'Hell', 'palette.skinB': 'Leicht gebräunt', 'palette.skinC': 'Gebräunt', 'palette.skinD': 'Braun', 'palette.skinE': 'Dunkel',
  'palette.hairBlack': 'Schwarz', 'palette.hairBrown': 'Braun', 'palette.hairBlond': 'Blond', 'palette.hairRed': 'Rot', 'palette.hairGrey': 'Grau',
  'palette.white': 'Weiß', 'palette.cream': 'Creme', 'palette.red': 'Rot', 'palette.orange': 'Orange', 'palette.yellow': 'Gelb',
  'palette.leaf': 'Blattgrün', 'palette.green': 'Grün', 'palette.teal': 'Türkis', 'palette.blue': 'Blau', 'palette.navy': 'Marineblau',
  'palette.purple': 'Lila', 'palette.pink': 'Rosa', 'palette.brown': 'Braun', 'palette.tan': 'Hellbraun', 'palette.straw': 'Stroh',
  'palette.wood': 'Holz', 'palette.grey': 'Grau', 'palette.steel': 'Stahl', 'palette.black': 'Schwarz',
};

/** German names of the catalogue items, by id. A bar marks where a long compound may break in a narrow card; it becomes a soft hyphen. */
const deItems: Record<string, string> = {
  'sprite-axe-0': 'Handbeil aus Feuer|stein',
  'sprite-axe-1': 'Obsidian|beil',
  'sprite-axe-2': 'Hackbeil aus Fluss|kiesel',
  'sprite-bandana-0': 'Rotes Stirn|band',
  'sprite-bandana-1': 'Rotes Kopf|tuch',
  'sprite-bandana-2': 'Gepunktetes Tuch mit langen Zipfeln',
  'sprite-beard-0': 'Vollbart',
  'sprite-beard-1': 'Brust|langer Bart',
  'sprite-beard-2': 'Wilder buschiger Bart',
  'sprite-cap-0': 'Verbeulte Kapitäns|mütze',
  'sprite-cap-1': 'Geflickte Kapitäns|mütze mit Gold|borte',
  'sprite-cap-2': 'Ausge|blichene Schiffer|mütze',
  'sprite-carried-0': 'Kleiner brauner Leder|koffer',
  'sprite-carried-1': 'Schwarzer Regen|schirm',
  'sprite-carried-2': 'Messing|laterne',
  'sprite-casual-0': 'Matrosen|hemd',
  'sprite-casual-1': 'Grüner Kapuzen|pulli',
  'sprite-casual-2': 'Rosa Bluse',
  'sprite-dresses-0': 'Gelbes Sommer|kleid',
  'sprite-dresses-1': 'Schwarzes Abend|kleid',
  'sprite-dresses-2': 'Blaues Träger|kleid mit weißer Bluse',
  'sprite-everyday-bottoms-0': 'Blaue Jeans mit braunem Gürtel',
  'sprite-everyday-bottoms-1': 'Graue Anzug|hose',
  'sprite-everyday-bottoms-2': 'Roter Falten|rock',
  'sprite-formal-0': 'Dunkles Anzug|jackett',
  'sprite-formal-1': 'Marine|blaue Offiziers|jacke',
  'sprite-formal-2': 'Weiße zwei|reihige Koch|jacke',
  'sprite-hat-0': 'Klassischer Stroh|hut',
  'sprite-hat-1': 'Geflochtener Kegel|hut',
  'sprite-hat-2': 'Ausge|franster Schlapp|hut aus Stroh',
  'sprite-leafskirt-0': 'Palm|blatt|rock',
  'sprite-leafskirt-1': 'Langer Palm|wedel|rock',
  'sprite-leafskirt-2': 'Kurzer zwei|stufiger Blätter|rock',
  'sprite-rod-0': 'Bambus|angel',
  'sprite-rod-1': 'Grüne Rohr|angel mit Schwimmer',
  'sprite-rod-2': 'Alte Angel mit eingehakter Schnur',
  'sprite-spear-0': 'Fisch|speer mit Feuer|stein|spitze',
  'sprite-spear-1': 'Fisch|speer mit Wider|haken',
  'sprite-spear-2': 'Rot umwickelter Schiefer|speer',
  'sprite-vest-0': 'Segel|tuch|weste mit Knoten',
  'sprite-vest-1': 'Lange geschnürte Segel|tuch|weste',
  'recipe-beard-0': 'Schiff|brüchigen|bart',
  'recipe-beard-1': 'Langer Zottel|bart',
  'recipe-beard-2': 'Wilder Rausche|bart',
  'recipe-bottoms-0': 'Lange marineblaue Hose',
  'recipe-bottoms-1': 'Hoch|gekrempelte hellbraune Hose',
  'recipe-bottoms-3': 'Gestreifter Wickel|rock',
  'recipe-bottoms-5': 'Creme|farbener Slip',
  'recipe-everyday-hats-0': 'Matrosen|mütze',
  'recipe-everyday-hats-1': 'Hohe Koch|mütze',
  'recipe-everyday-hats-2': 'Sonnen|hut mit Band',
  'recipe-everyday-0': 'Gestreiftes Polo|hemd',
  'recipe-everyday-1': 'Lang|ärmliger Pullover',
  'recipe-everyday-4': 'Knielange Shorts',
  'recipe-everyday-5': 'Langer Rock',
  'recipe-everyday-6': 'Schwarze Halb|schuhe',
  'recipe-everyday-7': 'Weiße Turn|schuhe',
  'recipe-everyday-8': 'Rote Pumps',
  'recipe-footwear-0': 'Hohe schwarze Stiefel',
  'recipe-footwear-1': 'Braune Stiefe|letten',
  'recipe-footwear-2': 'Gelbe Gummi|stiefel',
  'recipe-footwear-3': 'Wander|stiefel',
  'recipe-footwear-4': 'Stoff|turn|schuhe',
  'recipe-footwear-5': 'Leder|sandalen',
  'recipe-footwear-6': 'Flip-Flops',
  'recipe-footwear-7': 'Winter|stiefel mit Fell|besatz',
  'recipe-hair-loose-0': 'Lange Wellen mit Seiten|scheitel',
  'recipe-hair-loose-1': 'Kurze enge Locken',
  'recipe-hair-loose-2': 'Schulter|lang mit Mittel|scheitel',
  'recipe-hair-short-0': 'Irokesen|schnitt',
  'recipe-hair-short-1': 'Seiten|scheitel',
  'recipe-hair-short-2': 'Stoppel|schnitt',
  'recipe-hair-tied-0': 'Hoher Pferde|schwanz',
  'recipe-hair-tied-1': 'Zwei Zöpfe',
  'recipe-hair-tied-2': 'Langer geflochtener Zopf',
  'recipe-hairstyles-0': 'Dutt',
  'recipe-hairstyles-1': 'Afro',
  'recipe-hairstyles-2': 'Bob mit Pony',
  'recipe-hat-0': 'Sonnen|hut',
  'recipe-hat-1': 'Abgetragener Feldhut',
  'recipe-hat-2': 'Schlapper Garten|hut',
  'recipe-shoes-2': 'Fuß|wickel aus Stoff',
  'recipe-tops-0': 'Schlichtes T-Shirt',
  'recipe-tops-1': 'Träger|hemd',
  'recipe-tops-2': 'Lange Tunika',
  'recipe-tops-3': 'Kariertes Hemd',
  'recipe-tops-4': 'Offenes Hemd',
};

const STRINGS: Record<Lang, Record<Key, string>> = { en, de };
const ITEMS: Record<Lang, Record<string, string>> = { en: {}, de: deItems };
const STORAGE_KEY = 'castaway-wardrobe-lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.some((l) => l.id === saved)) return saved as Lang;
  } catch {
    // Without storage the browser's language decides.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let lang: Lang = initial();

export const currentLang = (): Lang => lang;

export function setLang(next: Lang): void {
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore: the choice then lasts for this visit only.
  }
}

/** The text for a key in the current language. `{name}` placeholders are filled from `values`. */
export function t(key: Key, values: Record<string, string | number> = {}): string {
  return (STRINGS[lang][key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) => String(values[name] ?? whole));
}

/** The name of a catalogue item in the current language, or the name the model gave it. */
export const itemName = (id: string, fallback: string): string => ITEMS[lang][id]?.replaceAll('|', '\u00AD') ?? fallback;

/** Ids that have no name in a language, for a check in development. */
export const missingItemNames = (ids: string[], language: Lang): string[] =>
  language === 'en' ? [] : ids.filter((id) => !ITEMS[language][id]);
