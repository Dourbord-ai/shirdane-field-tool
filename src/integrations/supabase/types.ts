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
      app_roles: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_user_roles: {
        Row: {
          assigned_at: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "app_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          is_active: boolean
          last_login_at: string | null
          password_hash: string
          role_id: string | null
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          password_hash: string
          role_id?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          password_hash?: string
          role_id?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "app_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      bankpartyaccountinfos: {
        Row: {
          bankpartyid: number | null
          id: number | null
          matchbankname: string | null
          matchcontent: string | null
          matchname: string | null
          matchtype: string | null
          status: string | null
        }
        Insert: {
          bankpartyid?: number | null
          id?: number | null
          matchbankname?: string | null
          matchcontent?: string | null
          matchname?: string | null
          matchtype?: string | null
          status?: string | null
        }
        Update: {
          bankpartyid?: number | null
          id?: number | null
          matchbankname?: string | null
          matchcontent?: string | null
          matchname?: string | null
          matchtype?: string | null
          status?: string | null
        }
        Relationships: []
      }
      breeding_alerts: {
        Row: {
          alert_date: string
          cow_id: number
          created_at: string
          description: string | null
          expires_at: string | null
          fertility_operation_id: number | null
          id: string
          reference_event_id: string | null
          rule_id: string | null
          status: string
          title: string
          workflow_id: string | null
        }
        Insert: {
          alert_date?: string
          cow_id: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          fertility_operation_id?: number | null
          id?: string
          reference_event_id?: string | null
          rule_id?: string | null
          status?: string
          title: string
          workflow_id?: string | null
        }
        Update: {
          alert_date?: string
          cow_id?: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          fertility_operation_id?: number | null
          id?: string
          reference_event_id?: string | null
          rule_id?: string | null
          status?: string
          title?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breeding_alerts_fertility_operation_id_fkey"
            columns: ["fertility_operation_id"]
            isOneToOne: false
            referencedRelation: "fertility_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breeding_alerts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "breeding_workflow_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breeding_alerts_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "breeding_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      breeding_workflow_rule_conditions: {
        Row: {
          bool_value: boolean | null
          condition_type: string
          created_at: string
          extra_json: Json
          id: string
          max_value: number | null
          min_value: number | null
          rule_id: string
          text_value: string | null
        }
        Insert: {
          bool_value?: boolean | null
          condition_type: string
          created_at?: string
          extra_json?: Json
          id?: string
          max_value?: number | null
          min_value?: number | null
          rule_id: string
          text_value?: string | null
        }
        Update: {
          bool_value?: boolean | null
          condition_type?: string
          created_at?: string
          extra_json?: Json
          id?: string
          max_value?: number | null
          min_value?: number | null
          rule_id?: string
          text_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breeding_workflow_rule_conditions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "breeding_workflow_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      breeding_workflow_rules: {
        Row: {
          alert_enabled: boolean
          alert_group_id: string | null
          created_at: string
          description: string | null
          duration_of_credit: number | null
          fertility_operation_id: number
          id: string
          is_active: boolean
          rule_order: number
          title: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          alert_enabled?: boolean
          alert_group_id?: string | null
          created_at?: string
          description?: string | null
          duration_of_credit?: number | null
          fertility_operation_id: number
          id?: string
          is_active?: boolean
          rule_order?: number
          title: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          alert_enabled?: boolean
          alert_group_id?: string | null
          created_at?: string
          description?: string | null
          duration_of_credit?: number | null
          fertility_operation_id?: number
          id?: string
          is_active?: boolean
          rule_order?: number
          title?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "breeding_workflow_rules_fertility_operation_id_fkey"
            columns: ["fertility_operation_id"]
            isOneToOne: false
            referencedRelation: "fertility_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breeding_workflow_rules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "breeding_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      breeding_workflows: {
        Row: {
          category: number
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          name: string
          start_date: string | null
          type: string
          updated_at: string
        }
        Insert: {
          category?: number
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name: string
          start_date?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          category?: number
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      buy_cattle_shoppingcenter: {
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
      certificates: {
        Row: {
          attachment_urls: string[]
          created_at: string
          created_by: string | null
          description: string | null
          doc_number: string | null
          doc_type: string
          expiry_date_shamsi: string | null
          id: number
          image_url: string | null
          issue_date_shamsi: string | null
          issuer: string | null
          renewal_custom_date_shamsi: string | null
          renewal_lead_time: string | null
          renewal_ticket_created_at: string | null
          renewal_ticket_id: number | null
          title: string
          updated_at: string
        }
        Insert: {
          attachment_urls?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          doc_number?: string | null
          doc_type?: string
          expiry_date_shamsi?: string | null
          id?: number
          image_url?: string | null
          issue_date_shamsi?: string | null
          issuer?: string | null
          renewal_custom_date_shamsi?: string | null
          renewal_lead_time?: string | null
          renewal_ticket_created_at?: string | null
          renewal_ticket_id?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          attachment_urls?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          doc_number?: string | null
          doc_type?: string
          expiry_date_shamsi?: string | null
          id?: number
          image_url?: string | null
          issue_date_shamsi?: string | null
          issuer?: string | null
          renewal_custom_date_shamsi?: string | null
          renewal_lead_time?: string | null
          renewal_ticket_created_at?: string | null
          renewal_ticket_id?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      cow_factor_details: {
        Row: {
          cow_id: number
          created_at: string
          delivery_cost: number | null
          description: string | null
          existence_status: number
          factor_id: string
          id: string
          off_unit_price: number | null
          payable_unit_price: number | null
          row_price: number
          unit_price: number
          vat: number | null
          weight: number
        }
        Insert: {
          cow_id: number
          created_at?: string
          delivery_cost?: number | null
          description?: string | null
          existence_status: number
          factor_id: string
          id?: string
          off_unit_price?: number | null
          payable_unit_price?: number | null
          row_price?: number
          unit_price: number
          vat?: number | null
          weight: number
        }
        Update: {
          cow_id?: number
          created_at?: string
          delivery_cost?: number | null
          description?: string | null
          existence_status?: number
          factor_id?: string
          id?: string
          off_unit_price?: number | null
          payable_unit_price?: number | null
          row_price?: number
          unit_price?: number
          vat?: number | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "cow_factor_details_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "factors"
            referencedColumns: ["id"]
          },
        ]
      }
      cows: {
        Row: {
          bodynumber: number | null
          created_at: string
          earnumber: number | null
          existancestatus: number | null
          existancestatusdes: string | null
          id: number
          is_dry: boolean | null
          last_fertility_status: number | null
          presence_status: number | null
          purchase_date: string | null
          purchase_invoice_number: string | null
          purchase_price: number | null
          sex: number | null
          sextype: string | null
          supplier: string | null
          tag_number: string | null
          updated_at: string
        }
        Insert: {
          bodynumber?: number | null
          created_at?: string
          earnumber?: number | null
          existancestatus?: number | null
          existancestatusdes?: string | null
          id: number
          is_dry?: boolean | null
          last_fertility_status?: number | null
          presence_status?: number | null
          purchase_date?: string | null
          purchase_invoice_number?: string | null
          purchase_price?: number | null
          sex?: number | null
          sextype?: string | null
          supplier?: string | null
          tag_number?: string | null
          updated_at?: string
        }
        Update: {
          bodynumber?: number | null
          created_at?: string
          earnumber?: number | null
          existancestatus?: number | null
          existancestatusdes?: string | null
          id?: number
          is_dry?: boolean | null
          last_fertility_status?: number | null
          presence_status?: number | null
          purchase_date?: string | null
          purchase_invoice_number?: string | null
          purchase_price?: number | null
          sex?: number | null
          sextype?: string | null
          supplier?: string | null
          tag_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      daily_worker_items: {
        Row: {
          created_at: string
          daily_rate: number | null
          days_count: number | null
          description: string | null
          end_date: string | null
          factor_id: string
          hourly_rate: number | null
          hours_count: number | null
          id: string
          purpose: string | null
          row_total: number | null
          start_date: string | null
          worker_name: string | null
        }
        Insert: {
          created_at?: string
          daily_rate?: number | null
          days_count?: number | null
          description?: string | null
          end_date?: string | null
          factor_id: string
          hourly_rate?: number | null
          hours_count?: number | null
          id?: string
          purpose?: string | null
          row_total?: number | null
          start_date?: string | null
          worker_name?: string | null
        }
        Update: {
          created_at?: string
          daily_rate?: number | null
          days_count?: number | null
          description?: string | null
          end_date?: string | null
          factor_id?: string
          hourly_rate?: number | null
          hours_count?: number | null
          id?: string
          purpose?: string | null
          row_total?: number | null
          start_date?: string | null
          worker_name?: string | null
        }
        Relationships: []
      }
      factor_attachments: {
        Row: {
          created_at: string
          factor_id: string
          file_name: string | null
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
        }
        Insert: {
          created_at?: string
          factor_id: string
          file_name?: string | null
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
        }
        Update: {
          created_at?: string
          factor_id?: string
          file_name?: string | null
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
        }
        Relationships: []
      }
      factor_item_type: {
        Row: {
          category: string
          id: number
          name: string | null
        }
        Insert: {
          category?: string
          id: number
          name?: string | null
        }
        Update: {
          category?: string
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      factor_item_type_id: {
        Row: {
          factortypeid: number | null
          id: number
          name: string | null
        }
        Insert: {
          factortypeid?: number | null
          id: number
          name?: string | null
        }
        Update: {
          factortypeid?: number | null
          id?: number
          name?: string | null
        }
        Relationships: []
      }
      factors: {
        Row: {
          buyer_type: string | null
          buyer_user_id: number | null
          checkout_type_id: number | null
          company: string | null
          created_at: string
          delivery_date: string | null
          delivery_percent: number | null
          description: string | null
          discount: number | null
          factor_type_id: number | null
          id: string
          image: string | null
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string
          off_percent: number | null
          other_center_address: string | null
          other_center_description: string | null
          other_center_name: string | null
          other_center_phone: string | null
          payable_amount: number | null
          product_type: string
          product_type_id: number | null
          seller_buyer_type: number | null
          settlement_date: string | null
          settlement_number: string | null
          settlement_type: string | null
          shipping: number | null
          shopping_center_id: number | null
          sync_status: string
          tax: string | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string
          vat_percent: number | null
        }
        Insert: {
          buyer_type?: string | null
          buyer_user_id?: number | null
          checkout_type_id?: number | null
          company?: string | null
          created_at?: string
          delivery_date?: string | null
          delivery_percent?: number | null
          description?: string | null
          discount?: number | null
          factor_type_id?: number | null
          id?: string
          image?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type: string
          off_percent?: number | null
          other_center_address?: string | null
          other_center_description?: string | null
          other_center_name?: string | null
          other_center_phone?: string | null
          payable_amount?: number | null
          product_type: string
          product_type_id?: number | null
          seller_buyer_type?: number | null
          settlement_date?: string | null
          settlement_number?: string | null
          settlement_type?: string | null
          shipping?: number | null
          shopping_center_id?: number | null
          sync_status?: string
          tax?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
          vat_percent?: number | null
        }
        Update: {
          buyer_type?: string | null
          buyer_user_id?: number | null
          checkout_type_id?: number | null
          company?: string | null
          created_at?: string
          delivery_date?: string | null
          delivery_percent?: number | null
          description?: string | null
          discount?: number | null
          factor_type_id?: number | null
          id?: string
          image?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string
          off_percent?: number | null
          other_center_address?: string | null
          other_center_description?: string | null
          other_center_name?: string | null
          other_center_phone?: string | null
          payable_amount?: number | null
          product_type?: string
          product_type_id?: number | null
          seller_buyer_type?: number | null
          settlement_date?: string | null
          settlement_number?: string | null
          settlement_type?: string | null
          shipping?: number | null
          shopping_center_id?: number | null
          sync_status?: string
          tax?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
          vat_percent?: number | null
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
      fertility_erotic_types: {
        Row: {
          code: string | null
          created_at: string
          description: string | null
          id: number
          is_active: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: number
          is_active?: boolean
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: number
          is_active?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      fertility_event_audit_logs: {
        Row: {
          action: string
          created_at: string
          fertility_event_id: string
          id: string
          new_data: Json | null
          old_data: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          fertility_event_id: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          fertility_event_id?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      fertility_heat_types: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      fertility_operations: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name: string
          operation_name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id: number
          is_active?: boolean
          name: string
          operation_name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string
          operation_name?: string
          sort_order?: number
        }
        Relationships: []
      }
      fertility_statuses: {
        Row: {
          color: string
          created_at: string
          id: number
          is_abortion: boolean
          milking_state: string
          name: string
          pregnancy_state: string
          sort_order: number
        }
        Insert: {
          color?: string
          created_at?: string
          id: number
          is_abortion?: boolean
          milking_state?: string
          name: string
          pregnancy_state?: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: number
          is_abortion?: boolean
          milking_state?: string
          name?: string
          pregnancy_state?: string
          sort_order?: number
        }
        Relationships: []
      }
      hr_attendance: {
        Row: {
          created_at: string
          entry_at: string
          entry_date_shamsi: string | null
          entry_type: string
          id: string
          notes: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          entry_at: string
          entry_date_shamsi?: string | null
          entry_type: string
          id?: string
          notes?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          entry_at?: string
          entry_date_shamsi?: string | null
          entry_type?: string
          id?: string
          notes?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      hr_attendance_records: {
        Row: {
          created_at: string
          date_shamsi: string
          early_leave_minutes: number
          hourly_leave_minutes: number
          id: string
          in1: string | null
          in2: string | null
          in3: string | null
          late_minutes: number
          mission_minutes: number
          notes: string | null
          other_entries: string | null
          out1: string | null
          out2: string | null
          out3: string | null
          overtime_minutes: number
          presence_minutes: number
          rest_minutes: number
          shift_type: string | null
          shortfall_minutes: number
          status: string
          updated_at: string
          user_id: string
          user_name: string | null
          weekday: string | null
          worked_minutes: number
        }
        Insert: {
          created_at?: string
          date_shamsi: string
          early_leave_minutes?: number
          hourly_leave_minutes?: number
          id?: string
          in1?: string | null
          in2?: string | null
          in3?: string | null
          late_minutes?: number
          mission_minutes?: number
          notes?: string | null
          other_entries?: string | null
          out1?: string | null
          out2?: string | null
          out3?: string | null
          overtime_minutes?: number
          presence_minutes?: number
          rest_minutes?: number
          shift_type?: string | null
          shortfall_minutes?: number
          status?: string
          updated_at?: string
          user_id: string
          user_name?: string | null
          weekday?: string | null
          worked_minutes?: number
        }
        Update: {
          created_at?: string
          date_shamsi?: string
          early_leave_minutes?: number
          hourly_leave_minutes?: number
          id?: string
          in1?: string | null
          in2?: string | null
          in3?: string | null
          late_minutes?: number
          mission_minutes?: number
          notes?: string | null
          other_entries?: string | null
          out1?: string | null
          out2?: string | null
          out3?: string | null
          overtime_minutes?: number
          presence_minutes?: number
          rest_minutes?: number
          shift_type?: string | null
          shortfall_minutes?: number
          status?: string
          updated_at?: string
          user_id?: string
          user_name?: string | null
          weekday?: string | null
          worked_minutes?: number
        }
        Relationships: []
      }
      hr_leave: {
        Row: {
          created_at: string
          date_shamsi: string | null
          days: number | null
          from_date_shamsi: string | null
          from_time: string | null
          hours: number | null
          id: string
          leave_kind: string
          leave_type: string | null
          reason: string | null
          to_date_shamsi: string | null
          to_time: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          date_shamsi?: string | null
          days?: number | null
          from_date_shamsi?: string | null
          from_time?: string | null
          hours?: number | null
          id?: string
          leave_kind: string
          leave_type?: string | null
          reason?: string | null
          to_date_shamsi?: string | null
          to_time?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          date_shamsi?: string | null
          days?: number | null
          from_date_shamsi?: string | null
          from_time?: string | null
          hours?: number | null
          id?: string
          leave_kind?: string
          leave_type?: string | null
          reason?: string | null
          to_date_shamsi?: string | null
          to_time?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      hr_missions: {
        Row: {
          created_at: string
          date_shamsi: string
          description: string | null
          destination: string | null
          id: string
          subject: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          date_shamsi: string
          description?: string | null
          destination?: string | null
          id?: string
          subject?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          date_shamsi?: string
          description?: string | null
          destination?: string | null
          id?: string
          subject?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      hr_notification_alerts: {
        Row: {
          alert_date: string
          alert_type: string
          created_at: string
          dismissed_until: string | null
          hr_user_id: number
          id: string
          last_sent_at: string | null
          message: string
          status: string
          title: string
          updated_at: string
          user_id: string | null
          username: string
        }
        Insert: {
          alert_date: string
          alert_type: string
          created_at?: string
          dismissed_until?: string | null
          hr_user_id: number
          id?: string
          last_sent_at?: string | null
          message: string
          status?: string
          title: string
          updated_at?: string
          user_id?: string | null
          username: string
        }
        Update: {
          alert_date?: string
          alert_type?: string
          created_at?: string
          dismissed_until?: string | null
          hr_user_id?: number
          id?: string
          last_sent_at?: string | null
          message?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string | null
          username?: string
        }
        Relationships: []
      }
      hr_overtime: {
        Row: {
          created_at: string
          date_shamsi: string
          hours: number
          id: string
          reason: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          date_shamsi: string
          hours?: number
          id?: string
          reason?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          date_shamsi?: string
          hours?: number
          id?: string
          reason?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      hr_profiles: {
        Row: {
          created_at: string
          hr_user_id: number | null
          id: string
          on_call_colleagues: boolean
          on_call_representatives: boolean
          on_call_tickets: boolean
          updated_at: string
          user_id: string
          user_name: string
        }
        Insert: {
          created_at?: string
          hr_user_id?: number | null
          id?: string
          on_call_colleagues?: boolean
          on_call_representatives?: boolean
          on_call_tickets?: boolean
          updated_at?: string
          user_id: string
          user_name: string
        }
        Update: {
          created_at?: string
          hr_user_id?: number | null
          id?: string
          on_call_colleagues?: boolean
          on_call_representatives?: boolean
          on_call_tickets?: boolean
          updated_at?: string
          user_id?: string
          user_name?: string
        }
        Relationships: []
      }
      hr_requests_log: {
        Row: {
          created_at: string
          error: string | null
          hr_user_id: number | null
          id: string
          legacy_payload: Json | null
          payload: Json | null
          request_type: string
          response: Json | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          hr_user_id?: number | null
          id?: string
          legacy_payload?: Json | null
          payload?: Json | null
          request_type: string
          response?: Json | null
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          hr_user_id?: number | null
          id?: string
          legacy_payload?: Json | null
          payload?: Json | null
          request_type?: string
          response?: Json | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      hr_shifts: {
        Row: {
          created_at: string
          end_time: string | null
          id: string
          notes: string | null
          shift_date_shamsi: string
          shift_type: string | null
          start_time: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          end_time?: string | null
          id?: string
          notes?: string | null
          shift_date_shamsi: string
          shift_type?: string | null
          start_time?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          end_time?: string | null
          id?: string
          notes?: string | null
          shift_date_shamsi?: string
          shift_type?: string | null
          start_time?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      hr_users: {
        Row: {
          app_username: string | null
          created_at: string | null
          first_name: string | null
          id: number
          last_name: string | null
          password_hash: string
          personnel_code: string | null
          username: string
        }
        Insert: {
          app_username?: string | null
          created_at?: string | null
          first_name?: string | null
          id: number
          last_name?: string | null
          password_hash: string
          personnel_code?: string | null
          username: string
        }
        Update: {
          app_username?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: number
          last_name?: string | null
          password_hash?: string
          personnel_code?: string | null
          username?: string
        }
        Relationships: []
      }
      lab_results: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          month: number
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          month: number
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          month?: number
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      livestock_events: {
        Row: {
          cow_id: number
          created_at: string
          description: string | null
          event_date: string | null
          event_type: string
          from_value: string | null
          id: string
          to_value: string | null
        }
        Insert: {
          cow_id: number
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type: string
          from_value?: string | null
          id?: string
          to_value?: string | null
        }
        Update: {
          cow_id?: number
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type?: string
          from_value?: string | null
          id?: string
          to_value?: string | null
        }
        Relationships: []
      }
      livestock_fertility_events: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          created_at: string
          created_by: string | null
          erotic_type_id: number | null
          event_date: string | null
          event_time: string | null
          event_type: string
          fertility_operation_id: number | null
          fertility_status_id: number | null
          id: string
          is_cancelled: boolean
          legacy_record_id: number | null
          legacy_table_name: string | null
          livestock_id: number
          metadata: Json
          notes: string | null
          operator_name: string | null
          operator_user_id: number | null
          result: string | null
          result_code: string | null
          status_code: number | null
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          erotic_type_id?: number | null
          event_date?: string | null
          event_time?: string | null
          event_type: string
          fertility_operation_id?: number | null
          fertility_status_id?: number | null
          id?: string
          is_cancelled?: boolean
          legacy_record_id?: number | null
          legacy_table_name?: string | null
          livestock_id: number
          metadata?: Json
          notes?: string | null
          operator_name?: string | null
          operator_user_id?: number | null
          result?: string | null
          result_code?: string | null
          status_code?: number | null
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          erotic_type_id?: number | null
          event_date?: string | null
          event_time?: string | null
          event_type?: string
          fertility_operation_id?: number | null
          fertility_status_id?: number | null
          id?: string
          is_cancelled?: boolean
          legacy_record_id?: number | null
          legacy_table_name?: string | null
          livestock_id?: number
          metadata?: Json
          notes?: string | null
          operator_name?: string | null
          operator_user_id?: number | null
          result?: string | null
          result_code?: string | null
          status_code?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "livestock_fertility_events_erotic_type_id_fkey"
            columns: ["erotic_type_id"]
            isOneToOne: false
            referencedRelation: "fertility_erotic_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "livestock_fertility_events_fertility_operation_id_fkey"
            columns: ["fertility_operation_id"]
            isOneToOne: false
            referencedRelation: "fertility_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "livestock_fertility_events_fertility_status_id_fkey"
            columns: ["fertility_status_id"]
            isOneToOne: false
            referencedRelation: "fertility_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      livestock_items: {
        Row: {
          animal_number: string | null
          created_at: string
          description: string | null
          factor_id: string
          id: string
          price_per_kg: number | null
          row_total: number | null
          weight_kg: number | null
        }
        Insert: {
          animal_number?: string | null
          created_at?: string
          description?: string | null
          factor_id: string
          id?: string
          price_per_kg?: number | null
          row_total?: number | null
          weight_kg?: number | null
        }
        Update: {
          animal_number?: string | null
          created_at?: string
          description?: string | null
          factor_id?: string
          id?: string
          price_per_kg?: number | null
          row_total?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "livestock_items_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "factors"
            referencedColumns: ["id"]
          },
        ]
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
      milk_receipts: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          month: number
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          month: number
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          month?: number
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      other_shoppingcenter: {
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      rental_items: {
        Row: {
          amount: number | null
          created_at: string
          description: string | null
          driver_name: string | null
          factor_id: string
          iban_or_card: string | null
          id: string
          purpose: string | null
          row_total: number | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          description?: string | null
          driver_name?: string | null
          factor_id: string
          iban_or_card?: string | null
          id?: string
          purpose?: string | null
          row_total?: number | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          description?: string | null
          driver_name?: string | null
          factor_id?: string
          iban_or_card?: string | null
          id?: string
          purpose?: string | null
          row_total?: number | null
        }
        Relationships: []
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
      sync_queue: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          last_error: string | null
          payload: Json
          retry_count: number
          status: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          last_error?: string | null
          payload: Json
          retry_count?: number
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          retry_count?: number
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wage_items: {
        Row: {
          account_holder: string | null
          contract_amount: number | null
          created_at: string
          daily_amount: number | null
          description: string | null
          end_date: string | null
          factor_id: string
          iban_or_card: string | null
          id: string
          payment_type: string | null
          purpose: string | null
          row_total: number | null
          start_date: string | null
          work_mode: string | null
        }
        Insert: {
          account_holder?: string | null
          contract_amount?: number | null
          created_at?: string
          daily_amount?: number | null
          description?: string | null
          end_date?: string | null
          factor_id: string
          iban_or_card?: string | null
          id?: string
          payment_type?: string | null
          purpose?: string | null
          row_total?: number | null
          start_date?: string | null
          work_mode?: string | null
        }
        Update: {
          account_holder?: string | null
          contract_amount?: number | null
          created_at?: string
          daily_amount?: number | null
          description?: string | null
          end_date?: string | null
          factor_id?: string
          iban_or_card?: string | null
          id?: string
          payment_type?: string | null
          purpose?: string | null
          row_total?: number | null
          start_date?: string | null
          work_mode?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_app_users_for_hr_users: {
        Args: { _default_password_hash?: string }
        Returns: {
          created_username: string
          hr_user_id: number
        }[]
      }
      has_app_role: {
        Args: { _role_name: string; _user_id: string }
        Returns: boolean
      }
      submit_cow_factor: {
        Args: { p_details: Json; p_factor: Json }
        Returns: Json
      }
      sync_hr_profiles_from_hr_users: {
        Args: never
        Returns: {
          action: string
          app_user_id: string
          hr_user_id: number
          username: string
        }[]
      }
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
