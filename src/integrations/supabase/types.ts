export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cows: {
        Row: {
          bodynumber: number | null
          earnumber: number | null
          existancestatus: number | null
          existancestatusdes: string | null
          id: number
          sex: number | null
          sextype: string | null
        }
        Insert: {
          bodynumber?: number | null
          earnumber?: number | null
          existancestatus?: number | null
          existancestatusdes?: string | null
          id: number
          sex?: number | null
          sextype?: string | null
        }
        Update: {
          bodynumber?: number | null
          earnumber?: number | null
          existancestatus?: number | null
          existancestatusdes?: string | null
          id?: number
          sex?: number | null
          sextype?: string | null
        }
        Relationships: []
      }
      factors: {
        Row: {
          buyer_type: string | null
          company: string | null
          created_at: string
          delivery_date: string | null
          description: string | null
          discount: number | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string
          payable_amount: number | null
          product_type: string
          settlement_date: string | null
          settlement_number: string | null
          settlement_type: string | null
          shipping: number | null
          tax: string | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          buyer_type?: string | null
          company?: string | null
          created_at?: string
          delivery_date?: string | null
          description?: string | null
          discount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type: string
          payable_amount?: number | null
          product_type: string
          settlement_date?: string | null
          settlement_number?: string | null
          settlement_type?: string | null
          shipping?: number | null
          tax?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          buyer_type?: string | null
          company?: string | null
          created_at?: string
          delivery_date?: string | null
          description?: string | null
          discount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string
          payable_amount?: number | null
          product_type?: string
          settlement_date?: string | null
          settlement_number?: string | null
          settlement_type?: string | null
          shipping?: number | null
          tax?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      feed_items: {
        Row: {
          created_at: string
          description: string | null
          factor_id: string
          feed_name: string | null
          id: string
          moisture_loss: number | null
          price_per_kg: number | null
          row_total: number | null
          weight_kg: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          factor_id: string
          feed_name?: string | null
          id?: string
          moisture_loss?: number | null
          price_per_kg?: number | null
          row_total?: number | null
          weight_kg?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          factor_id?: string
          feed_name?: string | null
          id?: string
          moisture_loss?: number | null
          price_per_kg?: number | null
          row_total?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "feed_items_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "factors"
            referencedColumns: ["id"]
          },
        ]
      }
      feeds: {
        Row: {
          id: number
          name: string | null
        }
        Insert: {
          id: number
          name?: string | null
        }
        Update: {
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      feedshoppingcenter: {
        Row: {
          id: number
          name: string | null
        }
        Insert: {
          id: number
          name?: string | null
        }
        Update: {
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      medicine_items: {
        Row: {
          created_at: string
          description: string | null
          factor_id: string
          id: string
          medicine_name: string | null
          medicine_type: string | null
          quantity: number | null
          row_total: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          factor_id: string
          id?: string
          medicine_name?: string | null
          medicine_type?: string | null
          quantity?: number | null
          row_total?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          factor_id?: string
          id?: string
          medicine_name?: string | null
          medicine_type?: string | null
          quantity?: number | null
          row_total?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "medicine_items_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "factors"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          id: number
          medicinetypeid: number | null
          name: string | null
        }
        Insert: {
          id: number
          medicinetypeid?: number | null
          name?: string | null
        }
        Update: {
          id?: number
          medicinetypeid?: number | null
          name?: string | null
        }
        Relationships: []
      }
      medicineshoppingcenter: {
        Row: {
          id: number
          name: string | null
        }
        Insert: {
          id: number
          name?: string | null
        }
        Update: {
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      medicinetypes: {
        Row: {
          id: number
          name: string | null
        }
        Insert: {
          id: number
          name?: string | null
        }
        Update: {
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      milk: {
        Row: {
          created_at: string
          description: string | null
          factor_id: string
          fat: number | null
          id: string
          milk_sample: number | null
          price_per_kg: number | null
          protein: number | null
          quantity_kg: number | null
          quantity_liter: number | null
          row_total: number | null
          somatic: number | null
          total: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          factor_id: string
          fat?: number | null
          id?: string
          milk_sample?: number | null
          price_per_kg?: number | null
          protein?: number | null
          quantity_kg?: number | null
          quantity_liter?: number | null
          row_total?: number | null
          somatic?: number | null
          total?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          factor_id?: string
          fat?: number | null
          id?: string
          milk_sample?: number | null
          price_per_kg?: number | null
          protein?: number | null
          quantity_kg?: number | null
          quantity_liter?: number | null
          row_total?: number | null
          somatic?: number | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "milk_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "factors"
            referencedColumns: ["id"]
          },
        ]
      }
      spermbuy: {
        Row: {
          created_at: string
          description: string | null
          factor_id: string
          id: string
          quantity: number | null
          row_total: number | null
          sperm_code: string | null
          sperm_name: string | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          factor_id: string
          id?: string
          quantity?: number | null
          row_total?: number | null
          sperm_code?: string | null
          sperm_name?: string | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          factor_id?: string
          id?: string
          quantity?: number | null
          row_total?: number | null
          sperm_code?: string | null
          sperm_name?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "spermbuy_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "factors"
            referencedColumns: ["id"]
          },
        ]
      }
      sperms: {
        Row: {
          code: string | null
          id: number
          name: string | null
        }
        Insert: {
          code?: string | null
          id: number
          name?: string | null
        }
        Update: {
          code?: string | null
          id?: number
          name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
