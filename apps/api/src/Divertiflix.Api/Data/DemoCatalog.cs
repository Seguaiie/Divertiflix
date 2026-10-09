using Divertiflix.Domain;

namespace Divertiflix.Api.Data;

/// <summary>
/// Catalogue de démonstration, tant que Jellyfin et Audiobookshelf ne sont pas branchés.
/// Les « Originaux » sont des courts-métrages génératifs produits par tools/demo-media (jouables hors ligne) ;
/// Big Buck Bunny et Tears of Steel (Blender Foundation, CC BY 3.0) pointent vers des flux HLS publics ;
/// les autres films Blender sont référencés sans source de lecture, pour montrer le parcours « Demander ».
/// Les livres audio sont des extraits d'oeuvres du domaine public lus par une voix de synthèse.
/// </summary>
public static class DemoCatalog
{
    /// <summary>À incrémenter quand ce fichier change : le seeder réapplique alors le catalogue de démo une seule fois.</summary>
    public const int Version = 1;

    public sealed record Entry(
        string Slug, string Name, int Year, string Genre, int Minutes, string Maturity, double Rating, string? Director, string[] Cast,
        string[] Keywords, string Synopsis, TitleKind Kind = TitleKind.Movie, string? Stream = null,
        string? Author = null, string? Narrator = null, bool Art = true);

    private const string Synth = "Voix de synthèse (extrait de démonstration)";
    private const string Mux = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
    private const string Unified = "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8";

    public static readonly IReadOnlyList<Entry> All =
    [
        // ------------------------------------------------------------ Originaux (médias générés, toujours jouables)
        new("maree-basse", "Marée basse", 2024, "Drame", 4, "TP", 8.1, "Inès Carrow", ["Mathilde Rouvel", "Jonas Berg"],
            ["mer", "solitude", "mémoire", "contemplatif", "silence", "lumière"],
            "Sur une plage de l'Atlantique nord, une femme revient chaque soir mesurer la distance qui sépare la mer de la maison de son enfance.",
            Stream: "media:maree-basse/index.m3u8"),
        new("ligne-9", "Ligne 9", 2025, "Thriller", 3, "13+", 7.6, "Tomas Ekwall", ["Salomé Dufresne"],
            ["ville", "nuit", "tension", "mystère", "rythmé", "sombre"],
            "Dernier métro de la nuit. Une voyageuse comprend que quelqu'un reproduit ses gestes, avec une station de retard.",
            Stream: "media:ligne-9/index.m3u8"),
        new("orbite-silencieuse", "Orbite silencieuse", 2023, "Science-fiction", 6, "TP", 8.4, "Noor Haddad", ["Elias Varga"],
            ["espace", "solitude", "futur", "silence", "mystère", "contemplatif"],
            "Seul sur une station orbitale, un technicien reçoit chaque matin le même message, envoyé depuis un futur qui n'a pas encore eu lieu.",
            Stream: "media:orbite-silencieuse/index.m3u8"),
        new("les-hommes-pluie", "Les Hommes-Pluie", 2024, "Fantastique", 5, "TP", 8.0, "Camille Vasseur", ["Aya Lemoine", "Pablo Ferrer"],
            ["pluie", "ville", "enfance", "magie", "onirique", "poésie"],
            "Dans une ville où il pleut depuis onze ans, les enfants apprennent à lire les nuages comme d'autres lisent le journal.",
            Stream: "media:les-hommes-pluie/index.m3u8"),
        new("atlas-de-poche", "Atlas de poche", 2022, "Documentaire", 8, "TP", 7.7, "Idris Okafor", [],
            ["ville", "mémoire", "voyage", "contemplatif", "nostalgique", "lumière"],
            "Un cartographe amateur redessine à la main les cartes de son quartier et découvre tout ce que la ville a décidé d'oublier.",
            Stream: "media:atlas-de-poche/index.m3u8"),
        new("frequence-morte", "Fréquence morte", 2025, "Horreur", 4, "16+", 7.2, "Mireille Danjou", ["Léo Carvalho"],
            ["nuit", "sombre", "tension", "fantôme", "mystère", "silence"],
            "Une fréquence radio abandonnée se remet à émettre. Elle ne diffuse que les voix de personnes qui n'ont pas encore parlé.",
            Stream: "media:frequence-morte/index.m3u8"),
        new("dernier-festin", "Dernier festin", 2023, "Horreur", 5, "18+", 6.8, "Mireille Danjou", ["Rosalie Brandt", "Hugo Steen"],
            ["gore", "famille", "sombre", "tension", "créature"],
            "Un repas de famille qui s'éternise. Plus la table se vide, plus ce qui reste dans les assiettes ressemble à des souvenirs.",
            Stream: "media:dernier-festin/index.m3u8"),
        new("sucre-file", "Sucre filé", 2024, "Comédie", 3, "TP", 7.9, "Lucie Marchetti", ["Gaspard Lenoir", "Ivana Petrović"],
            ["humour", "absurde", "famille", "rythmé", "réconfortant"],
            "Un pâtissier perfectionniste affronte son pire cauchemar : la pièce montée d'un mariage refuse obstinément de rester debout.",
            Stream: "media:sucre-file/index.m3u8"),
        new("le-grand-depart", "Le Grand Départ", 2022, "Aventure", 7, "TP", 7.5, "Tomas Ekwall", ["Jade Moreau", "Samir Aït-Ali", "Nils Holm"],
            ["mer", "amitié", "voyage", "épique", "humour", "évasion"],
            "Trois amis, un voilier beaucoup trop petit et une carte qui ne dit la vérité qu'une fois sur deux.",
            Stream: "media:le-grand-depart/index.m3u8"),
        new("poussiere-d-etoiles", "Poussière d'étoiles", 2021, "Drame", 5, "TP", 8.2, "Noor Haddad", ["Anouk Delmas", "Rafael Ortiz"],
            ["désert", "nuit", "tendresse", "espace", "solitude", "lumière", "nostalgique"],
            "Deux astronomes amateurs s'écrivent à travers le désert, d'un observatoire à l'autre, sans jamais s'être rencontrés.",
            Stream: "media:poussiere-d-etoiles/index.m3u8"),
        new("bolero-des-machines", "Boléro des machines", 2023, "Science-fiction", 3, "TP", 7.4, "Idris Okafor", [],
            ["robot", "musique", "danse", "rythmé", "futur", "lumière"],
            "Une chorégraphie pour bras robotiques, composée en temps réel par la poussière qui flotte dans l'air d'une usine désertée.",
            Stream: "media:bolero-des-machines/index.m3u8"),
        new("foret-memoire", "Forêt-Mémoire", 2022, "Animation", 4, "TP", 8.3, "Camille Vasseur", [],
            ["forêt", "nature", "mémoire", "enfance", "tendresse", "sombre"],
            "Un renard retrouve, arbre après arbre, les souvenirs d'une forêt qui brûle.",
            Stream: "media:foret-memoire/index.m3u8"),
        new("theatre-d-anouk", "Le Petit Théâtre d'Anouk", 2021, "Animation", 3, "TP", 7.8, "Lucie Marchetti", [],
            ["enfance", "famille", "humour", "tendresse", "magie", "réconfortant"],
            "Anouk monte un spectacle d'ombres avec ses jouets et découvre que ses ombres ont leur propre avis sur la mise en scène.",
            Stream: "media:theatre-d-anouk/index.m3u8"),
        new("cartes-postales", "Cartes postales de l'apocalypse", 2025, "Animation", 5, "13+", 7.7, "Idris Okafor", [],
            ["apocalypse", "absurde", "humour", "voyage", "nostalgique"],
            "La fin du monde racontée en quarante cartes postales, tendres, absurdes et toutes écrites trop tard.",
            Stream: "media:cartes-postales/index.m3u8"),
        new("neon-et-pluie", "Néon & pluie", 2024, "Thriller", 4, "16+", 7.3, "Tomas Ekwall", ["Mina Okabe", "Viktor Lund"],
            ["ville", "nuit", "pluie", "enquête", "tension", "sombre"],
            "Une détective sans licence suit un parapluie jaune à travers une ville où chaque enseigne ment un peu.",
            Stream: "media:neon-et-pluie/index.m3u8"),
        new("le-dernier-cliche", "Le Dernier Cliché", 2023, "Thriller", 5, "13+", 7.5, "Salomé Dufresne", ["Théo Marin"],
            ["enquête", "mystère", "mémoire", "nuit", "ville", "tension"],
            "Un photographe développe la dernière pellicule de son frère disparu et y découvre une pièce qu'il n'a jamais visitée.",
            Stream: "media:le-dernier-cliche/index.m3u8"),
        new("jardin-d-hiver", "Jardin d'hiver", 2022, "Drame", 6, "TP", 8.0, "Inès Carrow", ["Mathilde Rouvel", "Georges Pelletier"],
            ["famille", "mémoire", "nostalgique", "tendresse", "silence", "lumière"],
            "Le dernier hiver d'une maison de famille, raconté par les pièces qu'on referme une à une.",
            Stream: "media:jardin-d-hiver/index.m3u8"),

        // ------------------------------------------------------------ Films Blender (CC BY 3.0, Blender Foundation)
        new("big-buck-bunny", "Big Buck Bunny", 2008, "Animation", 10, "TP", 7.9, "Sacha Goedegebure", [],
            ["nature", "forêt", "humour", "vengeance", "créature", "rythmé"],
            "Un lapin géant, doux et paisible, se venge de trois rongeurs qui ont gâché sa matinée.", Stream: Mux),
        new("tears-of-steel", "Tears of Steel", 2012, "Science-fiction", 12, "TP", 7.0, "Ian Hubert", [],
            ["robot", "futur", "guerre", "ville", "amitié", "épique"],
            "Des guerriers et des scientifiques tentent de sauver le monde des robots, dans un Amsterdam du futur.", Stream: Unified),
        new("sintel", "Sintel", 2010, "Fantastique", 15, "8+", 8.0, "Colin Levy", [],
            ["épique", "voyage", "créature", "montagne", "vengeance", "magie"],
            "Une jeune femme parcourt le monde à la recherche de son dragon, au prix de tout ce qu'elle possède.", Art: false),
        new("cosmos-laundromat", "Cosmos Laundromat", 2015, "Fantastique", 12, "13+", 7.6, "Mathieu Auvray", [],
            ["absurde", "solitude", "onirique", "désert", "mystère"],
            "Un mouton suicidaire rencontre un vendeur étrange qui lui propose d'essayer toutes les vies possibles.", Art: false),
        new("elephants-dream", "Elephants Dream", 2006, "Science-fiction", 11, "8+", 6.9, "Bassam Kurdali", [],
            ["onirique", "robot", "mystère", "futur", "rêve"],
            "Deux hommes explorent un monde de machines impossible, où chaque porte ouvre sur une logique différente.", Art: false),
        new("spring", "Spring", 2019, "Fantastique", 8, "TP", 7.8, "Andy Goralczyk", [],
            ["nature", "magie", "poésie", "épique", "montagne"],
            "Une bergère et son chien affrontent les esprits des saisons pour que le printemps revienne.", Art: false),

        // ------------------------------------------------------------ Livres audio (domaine public, voix de synthèse)
        new("candide", "Candide", 1759, "Satire", 2, "TP", 8.0, null, [],
            ["voyage", "humour", "absurde", "épique"],
            "Chassé du plus beau des châteaux, le jeune Candide parcourt le monde en croyant, malgré tout, que tout est pour le mieux.",
            TitleKind.Audiobook, "media:candide/audio.m4a", "Voltaire", Synth),
        new("les-fleurs-du-mal", "Les Fleurs du mal", 1857, "Poésie", 2, "TP", 8.5, null, [],
            ["poésie", "nuit", "ville", "sombre", "solitude", "nostalgique"],
            "Spleen, ivresse et beauté : le recueil qui a fait de Paris la capitale de la mélancolie moderne.",
            TitleKind.Audiobook, "media:les-fleurs-du-mal/audio.m4a", "Charles Baudelaire", Synth),
        new("frankenstein", "Frankenstein", 1818, "Gothique", 2, "13+", 8.2, null, [],
            ["créature", "sombre", "solitude", "tension", "mystère", "nuit"],
            "Un jeune savant donne la vie à une créature qu'il abandonne aussitôt, et doit répondre de ce qu'il a fait.",
            TitleKind.Audiobook, "media:frankenstein/audio.m4a", "Mary Shelley", Synth),
        new("dracula", "Dracula", 1897, "Gothique", 2, "13+", 8.0, null, [],
            ["créature", "nuit", "tension", "mystère", "sombre", "voyage"],
            "Le journal d'un jeune notaire voyageant vers un château des Carpates, où son hôte ne se montre qu'à la tombée du jour.",
            TitleKind.Audiobook, "media:dracula/audio.m4a", "Bram Stoker", Synth),
    ];
}
