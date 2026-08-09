// These must stay `type` aliases, not `interface` — using an interface here as a Database
// `Row` type breaks TypeScript's inference in @supabase/postgrest-js's insert/upsert
// generics, collapsing the accepted value type to `never[]`.
export type ItemPrice = {
  item_id: number;
  item_name: string;
  icon_url: string | null;
  price: number;
  updated_at: string;
  updated_by: string | null;
};

export type UserSale = {
  id: string;
  user_id: string;
  item_id: number;
  item_name: string;
  icon_url: string | null;
  quantity: number;
  unit_price: number;
  craft_cost: number;
  tax_paid: number;
  lot_size: 1 | 10 | 100 | 1000;
  lot_count: number;
  status: 'active' | 'sold';
  is_resale: boolean;
  created_at: string;
  sold_at: string | null;
};

/**
 * Une ligne rendue par la fonction `price_suggestions` (voir
 * 20260802120000_price_suggestions.sql). Les colonnes de métrique sont nullables
 * parce qu'elles n'ont de valeur que pour leur propre bloc : `recipe_count` pour
 * `most_used`, `craft_cost` pour `ready_recipe`, `cost_share`/`context_name`
 * pour `cost_driver`.
 */
export type PriceSuggestionBucket =
  | 'most_used'
  | 'ready_recipe'
  | 'cost_driver'
  | 'random';

export type PriceSuggestion = {
  bucket: PriceSuggestionBucket;
  item_id: number;
  item_name: string;
  img: string;
  super_type_id: number;
  has_recipe: boolean;
  /** `null` quand aucune ligne `item_prices` n'existe — l'item n'a jamais été rempli. */
  current_price: number | null;
  updated_at: string | null;
  recipe_count: number | null;
  craft_cost: number | null;
  /** Part du coût de craft, dans ]0,1]. */
  cost_share: number | null;
  context_name: string | null;
};

export interface DofusDBEffect {
  from: number;
  to: number;
  characteristic: number;
  category: number;
  elementId: number;
  effectId: number;
}

// Ces formes sont désormais servies depuis le miroir local (`dofus_items` /
// `dofus_recipes`), plus directement depuis api.dofusdb.fr. DofusDB renvoie cinq
// langues ; l'app n'a jamais lu que le français, donc le miroir ne stocke que
// `fr` et ces types sont restreints en conséquence. Le compilateur garantit
// ainsi qu'aucun appelant ne dépend d'une locale qu'on ne stocke plus.
export interface DofusDBItem {
  id: number;
  typeId: number;
  /** Détermine l'hôtel de vente de l'item — voir `lib/dofus/hdv.ts`. */
  superTypeId: number;
  iconId: number;
  level: number;
  name: { fr: string };
  description: { fr: string };
  img: string;
  slug: { fr: string };
  type: {
    id: number;
    name: { fr: string };
  };
  hasRecipe: boolean;
  effects?: DofusDBEffect[];
}

export interface DofusDBRecipe {
  id: number;
  resultId: number;
  resultTypeId: number;
  resultLevel: number;
  ingredientIds: number[];
  quantities: number[];
  jobId: number;
  skillId: number;
  resultName: { fr: string };
  result: DofusDBItem & {
    price: number;
  };
  ingredients: DofusDBItem[];
  job: {
    id: number;
    name: { fr: string };
    img: string;
  };
}

export interface DofusDBResponse<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

// Lignes du miroir du catalogue (voir 20260801090000_dofus_catalog_mirror.sql).
// Alimentées par scripts/sync-dofusdb.mjs ; l'app les lit uniquement, d'où
// l'absence d'Insert/Update exploitables côté client (RLS en select seul).
export type DofusItemRow = {
  id: number;
  type_id: number;
  super_type_id: number;
  icon_id: number;
  level: number;
  name_fr: string;
  type_name_fr: string;
  description_fr: string;
  slug_fr: string;
  has_recipe: boolean;
  effects: DofusDBEffect[];
  img: string;
  synced_at: string;
};

export type DofusRecipeRow = {
  id: number;
  result_id: number;
  result_type_id: number;
  result_super_type_id: number;
  result_level: number;
  result_name_fr: string;
  // Alignés par index : quantities[i] correspond à ingredient_ids[i].
  ingredient_ids: number[];
  quantities: number[];
  job_id: number;
  job_name_fr: string;
  job_img: string;
  skill_id: number;
  synced_at: string;
};

/** Les cinq éléments, dans l'ordre figé par `ELEMENTS` du script de sync. */
export const ELEMENTS = ['earth', 'air', 'fire', 'water', 'neutral'] as const;
export type Element = (typeof ELEMENTS)[number];

/** `res_fire_max`, `res_earth_min`… — dérivé pour que les colonnes ne dérivent pas des éléments. */
type ResistanceColumns = {
  [K in Element as `res_${K}_min` | `res_${K}_max`]: number;
};

export type DofusMonsterRow = ResistanceColumns & {
  id: number;
  name_fr: string;
  slug_fr: string;
  race: number;
  is_boss: boolean;
  is_mini_boss: boolean;
  /** 2 839 monstres sur 5 134 le portent : bien plus large que « exclusif aux quêtes ». */
  is_quest_monster: boolean;
  is_bounty: boolean;
  hide_in_bestiary: boolean;
  level_min: number;
  level_max: number;
  /** grade_levels[i] = niveau du grade i. De 3 à 11 entrées selon les monstres. */
  grade_levels: number[];
  grade_count: number;
  subarea_ids: number[];
  img: string;
  synced_at: string;
};

export type DofusDropRow = {
  monster_id: number;
  object_id: number;
  /** Expression de critères DofusDB, brute. Fait partie de la clé primaire. */
  criterions: string;
  has_criterions: boolean;
  percent_grade_1: number;
  percent_grade_2: number;
  percent_grade_3: number;
  percent_grade_4: number;
  percent_grade_5: number;
  /** Colonne générée : le plus grand des cinq grades. Jamais écrite par le client. */
  percent_max: number;
  max_count: number;
  synced_at: string;
};

export type DofusAreaRow = {
  id: number;
  name_fr: string;
  synced_at: string;
};

export type DofusSubareaRow = {
  id: number;
  area_id: number;
  name_fr: string;
  level: number;
  synced_at: string;
};

/** Une ligne de drop telle que `farm_targets` la sérialise dans `top_drops`. */
export type FarmDrop = {
  objectId: number;
  name: string;
  img: string;
  /** Taux après application de la prospection, plafonné à 100. */
  percent: number;
  price: number;
  hasCriterions: boolean;
  /** Expression brute, non interprétée. Vide quand il n'y a pas de condition. */
  criterions: string;
};

export type FarmTarget = {
  monster_id: number;
  monster_name: string;
  img: string;
  level_min: number;
  level_max: number;
  grade_count: number;
  is_boss: boolean;
  is_mini_boss: boolean;
  subarea_names: string[];
  /** Par élément, le couple [min, max] sur l'ensemble des grades. */
  resistances: Record<Element, [number, number]>;
  drop_count: number;
  /** Espérance de gain pour un combat, à la prospection demandée. */
  kamas_per_fight: number;
  top_drops: FarmDrop[];
};

export type DofusSyncStateRow = {
  resource: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  row_count: number;
  upstream_total: number | null;
  last_error: string | null;
};

/** Une ligne de `breeding_color_prices` (migration 20260803120000). */
export type BreedingColorPrice = {
  family: 'dragodinde' | 'muldo' | 'volkorne';
  color_id: string;
  /** 0 = poulain à la naissance, 200 = monture montée au maximum. */
  mount_level: 0 | 200;
  price: number;
  updated_at: string;
  updated_by: string | null;
};

/** Une ligne de `user_breeding_settings`, privée à chaque éleveur. */
export type UserBreedingSettings = {
  user_id: string;
  breeder_level: number;
  enclos_count: number;
  kamas_per_hour: number;
  /**
   * Kamas engageables. Distinct de `kamas_per_hour`, qui dit ce que vaut une
   * heure : celui-ci **contraint** le plan au lieu d'arbitrer. À 0, pas de
   * contrainte — un budget nul voudrait dire « je ne peux rien faire ».
   */
  kamas_available: number;
  minutes_per_fight: number;
  net_recovery_rate: number;
  recycle_steriles: boolean;
  never_sell_mounts: boolean;
  /**
   * Valoriser les bébés hors cible (migration 20260805220000).
   *
   * À `false`, un croisement raté ne rapporte rien : borne prudente, qui évite
   * que l'optimiseur choisisse de rater pour encaisser des ancêtres.
   */
  credit_off_target: boolean;
  /**
   * Imputer le prix de craft des filets au coût d'une capture
   * (migration 20260806090000).
   *
   * À `false`, seul le temps de combat est compté : le régime de qui récolte
   * ses propres matériaux, où le craft ne sort aucun kama de la poche.
   */
  count_net_cost: boolean;
  /** Plafond de jauge imposé, ou null pour laisser l'arbitrage temps/kamas décider. */
  gauge_cap: number | null;
  updated_at: string;
};

/** Un plan d'élevage suivi (migration 20260804160000), privé à son éleveur. */
export type BreedingProject = {
  id: string;
  user_id: string;
  family: 'dragodinde' | 'muldo' | 'volkorne';
  target_color_id: string;
  target_count: number;
  /**
   * Ce que le plan cherche (migration 20260805170000), et donc ce qui départage
   * deux couleurs. Voir `ObjectiveId` dans `lib/dofus/breeding/objectives.ts` :
   * la marge horaire ne peut pas désigner une route vers la génération 10, qui
   * perd toujours sur ce critère.
   */
  objective: 'profit' | 'gen10_balanced' | 'gen10_profit';
  created_at: string;
  updated_at: string;
};

/**
 * La timeline d'exécution (migration 20260809160000) : le plan du modèle, et où
 * l'on en est dedans.
 *
 * Le `plan` est du JSON brut, volontairement non typé ici : sa forme appartient
 * à l'optimiseur, qui évolue plus vite que le schéma. `parsePlan` dans
 * `lib/dofus/breeding/timeline.ts` le valide à la lecture, et c'est là qu'est le
 * contrat.
 *
 * Les trois colonnes d'horloge tiennent la pause : temps de plan =
 * `(paused_at ?? maintenant) − started_at − paused_seconds`.
 */
export type BreedingTimeline = {
  user_id: string;
  family: 'dragodinde' | 'muldo' | 'volkorne';
  plan: unknown;
  started_at: string;
  /** Instant de la pause en cours, ou null si la timeline tourne. */
  paused_at: string | null;
  /** Cumul des pauses **terminées**, en secondes. */
  paused_seconds: number;
  updated_at: string;
};

/**
 * Le vrac de l'écurie (migrations 20260804210000 puis 20260805120000) : les
 * générations 1 et 2, comptées **par sexe**. Ligne absente = zéro.
 *
 * Rattachée au joueur et non à un projet : posséder un muldo Roux allège tous
 * les plans qui en demandent, pas seulement celui qu'on suit.
 *
 * Le compteur unique d'avant ne suffisait pas : un accouplement demande un mâle
 * et une femelle, et dix mâles sans femelle ne font aucun couple. Au-delà de la
 * génération 2, voir `UserBreedingIndividual` — la généalogie y devient
 * discriminante et un compteur ne peut plus la porter.
 */
export type UserBreedingMount = {
  user_id: string;
  family: 'dragodinde' | 'muldo' | 'volkorne';
  color_id: string;
  males: number;
  females: number;
  updated_at: string;
};

/**
 * Une monture de génération 3 ou plus, suivie individuellement
 * (migration 20260805120000).
 *
 * Les couleurs des parents sont portées ici plutôt que déduites de la recette :
 * la distribution des couleurs à l'échec dépend de la généalogie de
 * l'**individu**, et deux montures de même couleur n'ont pas la même ascendance
 * selon d'où elles viennent. Les `_id` ne sont renseignés que lorsque le parent
 * est lui-même suivi — un parent de génération 1 ou 2 vit dans le vrac et n'a
 * pas d'identifiant.
 */
export type UserBreedingIndividual = {
  id: string;
  user_id: string;
  family: 'dragodinde' | 'muldo' | 'volkorne';
  color_id: string;
  /**
   * Le nom porté dans le jeu (migration 20260806190000), 20 caractères au plus.
   * `null` vaut « Anonyme », le défaut du jeu. Voir `naming.ts`.
   */
  name: string | null;
  sex: 'M' | 'F';
  level: number;
  fertile: boolean;
  /**
   * Accouplée et en gestation (migration 20260809190000). Va toujours avec
   * `fertile = false`, et s'en distingue par ce qu'elle interdit : une féconde
   * ne se clone pas, un poulain arrive. Voir `mountStatus`.
   */
  pregnant: boolean;
  parent_a_color: string | null;
  parent_b_color: string | null;
  parent_a_id: string | null;
  parent_b_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Un item en réserve — carburants d'enclos en pratique. */
export type UserItemStock = {
  user_id: string;
  item_id: number;
  quantity: number;
  updated_at: string;
};

/**
 * Le dernier réglage de la page Farm (migration 20260804230000).
 *
 * `filters` est volontairement non typé côté base : c'est un instantané de
 * `FarmFilterState`, relu à travers le recollage de `useFarmFilters`, qui est le
 * seul endroit à en connaître la forme.
 */
export type UserFarmFilters = {
  user_id: string;
  filters: unknown;
  updated_at: string;
};

export interface Database {
  public: {
    Tables: {
      user_farm_filters: {
        Row: UserFarmFilters;
        Insert: {
          user_id?: string;
          filters: unknown;
          updated_at?: string;
        };
        Update: {
          filters?: unknown;
          updated_at?: string;
        };
        Relationships: [];
      };
      breeding_projects: {
        Row: BreedingProject;
        Insert: {
          id?: string;
          user_id?: string;
          family: BreedingProject['family'];
          target_color_id: string;
          target_count?: number;
          objective?: BreedingProject['objective'];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          target_count?: number;
          objective?: BreedingProject['objective'];
          updated_at?: string;
        };
        Relationships: [];
      };
      breeding_timeline: {
        Row: BreedingTimeline;
        Insert: {
          user_id?: string;
          family: BreedingTimeline['family'];
          plan: unknown;
          started_at?: string;
          paused_at?: string | null;
          paused_seconds?: number;
          updated_at?: string;
        };
        Update: {
          plan?: unknown;
          started_at?: string;
          paused_at?: string | null;
          paused_seconds?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_breeding_mounts: {
        Row: UserBreedingMount;
        Insert: {
          user_id?: string;
          family: UserBreedingMount['family'];
          color_id: string;
          males?: number;
          females?: number;
          updated_at?: string;
        };
        Update: {
          males?: number;
          females?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_breeding_individuals: {
        Row: UserBreedingIndividual;
        Insert: {
          id?: string;
          user_id?: string;
          family: UserBreedingIndividual['family'];
          color_id: string;
          name?: string | null;
          sex: UserBreedingIndividual['sex'];
          level?: number;
          fertile?: boolean;
          pregnant?: boolean;
          parent_a_color?: string | null;
          parent_b_color?: string | null;
          parent_a_id?: string | null;
          parent_b_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          color_id?: string;
          name?: string | null;
          sex?: UserBreedingIndividual['sex'];
          level?: number;
          fertile?: boolean;
          pregnant?: boolean;
          parent_a_color?: string | null;
          parent_b_color?: string | null;
          parent_a_id?: string | null;
          parent_b_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_item_stock: {
        Row: UserItemStock;
        Insert: {
          user_id?: string;
          item_id: number;
          quantity?: number;
          updated_at?: string;
        };
        Update: {
          quantity?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      breeding_color_prices: {
        Row: BreedingColorPrice;
        Insert: {
          family: BreedingColorPrice['family'];
          color_id: string;
          mount_level: 0 | 200;
          price?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          family?: BreedingColorPrice['family'];
          color_id?: string;
          mount_level?: 0 | 200;
          price?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      user_breeding_settings: {
        Row: UserBreedingSettings;
        Insert: {
          user_id?: string;
          breeder_level?: number;
          enclos_count?: number;
          kamas_per_hour?: number;
          kamas_available?: number;
          minutes_per_fight?: number;
          net_recovery_rate?: number;
          recycle_steriles?: boolean;
          never_sell_mounts?: boolean;
          credit_off_target?: boolean;
          count_net_cost?: boolean;
          gauge_cap?: number | null;
          updated_at?: string;
        };
        Update: {
          breeder_level?: number;
          enclos_count?: number;
          kamas_per_hour?: number;
          kamas_available?: number;
          minutes_per_fight?: number;
          net_recovery_rate?: number;
          recycle_steriles?: boolean;
          never_sell_mounts?: boolean;
          credit_off_target?: boolean;
          count_net_cost?: boolean;
          gauge_cap?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      item_prices: {
        Row: ItemPrice;
        Insert: {
          item_id: number;
          item_name: string;
          icon_url?: string | null;
          price?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          item_id?: number;
          item_name?: string;
          icon_url?: string | null;
          price?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      user_sales: {
        Row: UserSale;
        Insert: {
          id?: string;
          user_id?: string;
          item_id: number;
          item_name: string;
          icon_url?: string | null;
          quantity?: number;
          unit_price: number;
          craft_cost?: number;
          tax_paid?: number;
          lot_size?: 1 | 10 | 100 | 1000;
          lot_count?: number;
          status?: 'active' | 'sold';
          is_resale?: boolean;
          created_at?: string;
          sold_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          item_id?: number;
          item_name?: string;
          icon_url?: string | null;
          quantity?: number;
          unit_price?: number;
          craft_cost?: number;
          tax_paid?: number;
          lot_size?: 1 | 10 | 100 | 1000;
          lot_count?: number;
          status?: 'active' | 'sold';
          is_resale?: boolean;
          sold_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      dofus_items: {
        Row: DofusItemRow;
        Insert: DofusItemRow;
        Update: Partial<DofusItemRow>;
        Relationships: [];
      };
      dofus_recipes: {
        Row: DofusRecipeRow;
        Insert: DofusRecipeRow;
        Update: Partial<DofusRecipeRow>;
        Relationships: [];
      };
      dofus_monsters: {
        Row: DofusMonsterRow;
        Insert: DofusMonsterRow;
        Update: Partial<DofusMonsterRow>;
        Relationships: [];
      };
      dofus_drops: {
        Row: DofusDropRow;
        // percent_max est généré par Postgres : jamais fourni à l'insertion.
        Insert: Omit<DofusDropRow, 'percent_max'>;
        Update: Partial<Omit<DofusDropRow, 'percent_max'>>;
        Relationships: [];
      };
      dofus_areas: {
        Row: DofusAreaRow;
        Insert: DofusAreaRow;
        Update: Partial<DofusAreaRow>;
        Relationships: [];
      };
      dofus_subareas: {
        Row: DofusSubareaRow;
        Insert: DofusSubareaRow;
        Update: Partial<DofusSubareaRow>;
        Relationships: [];
      };
      dofus_sync_state: {
        Row: DofusSyncStateRow;
        Insert: DofusSyncStateRow;
        Update: Partial<DofusSyncStateRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      sell_lots: {
        Args: { p_sale_id: string; p_count: number };
        Returns: undefined;
      };
      price_suggestions: {
        Args: {
          p_stale_days?: number;
          p_fallback_days?: number;
          p_per_bucket?: number;
          /** `null` = tous les métiers. */
          p_job_id?: number | null;
          p_include_quest?: boolean;
        };
        Returns: PriceSuggestion[];
      };
      farm_targets: {
        // Tous optionnels : les valeurs par défaut vivent dans la signature SQL
        // (migration 20260802210000), la route n'envoie que ce qui est demandé.
        Args: {
          p_min_level?: number;
          p_max_level?: number;
          p_subarea_ids?: number[];
          p_area_id?: number;
          p_exclude_boss?: boolean;
          p_exclude_mini_boss?: boolean;
          p_exclude_quest?: boolean;
          p_exclude_bounty?: boolean;
          p_exclude_hidden?: boolean;
          p_min_percent?: number;
          /** 100 = référence des taux DofusDB. */
          p_prospecting?: number;
          p_priced_only?: boolean;
          p_crafted_only?: boolean;
          /** Actif par défaut côté SQL. */
          p_exclude_quest_drops?: boolean;
          p_unconditional_only?: boolean;
          /** Sous-ensemble de `ELEMENTS`. */
          p_elements?: Element[];
          p_max_resistance?: number;
          p_limit?: number;
        };
        Returns: FarmTarget[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
