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

export type DofusSyncStateRow = {
  resource: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  row_count: number;
  upstream_total: number | null;
  last_error: string | null;
};

export interface Database {
  public: {
    Tables: {
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
        };
        Returns: PriceSuggestion[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
