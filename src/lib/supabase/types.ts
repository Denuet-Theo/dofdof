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

export interface DofusDBItem {
  id: number;
  typeId: number;
  iconId: number;
  level: number;
  name: {
    fr: string;
    en: string;
    de: string;
    es: string;
    pt: string;
  };
  description: {
    fr: string;
    en: string;
  };
  img: string;
  slug: {
    fr: string;
    en: string;
  };
  type: {
    id: number;
    name: {
      fr: string;
      en: string;
    };
  };
  hasRecipe: boolean;
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
  resultName: {
    fr: string;
    en: string;
  };
  result: DofusDBItem & {
    price: number;
  };
  ingredients: DofusDBItem[];
  job: {
    id: number;
    name: {
      fr: string;
      en: string;
    };
    img: string;
  };
}

export interface DofusDBResponse<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
