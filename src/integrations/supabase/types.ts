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
      cow_locations: {
        Row: {
          cow_id: number | null
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          event_date: string | null
          id: number
          is_deleted: boolean
          location_id: number | null
          old_cow_id: number | null
          old_id: number | null
          old_location_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          updated_at: string
        }
        Insert: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          event_date?: string | null
          id?: number
          is_deleted?: boolean
          location_id?: number | null
          old_cow_id?: number | null
          old_id?: number | null
          old_location_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Update: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          event_date?: string | null
          id?: number
          is_deleted?: boolean
          location_id?: number | null
          old_cow_id?: number | null
          old_id?: number | null
          old_location_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cow_locations_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "analytics_fertility_legacy_chart"
            referencedColumns: ["livestock_id"]
          },
          {
            foreignKeyName: "cow_locations_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "cows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cow_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "livestock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      cow_statuses: {
        Row: {
          cow_id: number | null
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          event_date: string | null
          id: number
          is_deleted: boolean
          old_cow_id: number | null
          old_id: number | null
          old_status_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          status_id: number | null
          updated_at: string
        }
        Insert: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          event_date?: string | null
          id?: number
          is_deleted?: boolean
          old_cow_id?: number | null
          old_id?: number | null
          old_status_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          status_id?: number | null
          updated_at?: string
        }
        Update: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          event_date?: string | null
          id?: number
          is_deleted?: boolean
          old_cow_id?: number | null
          old_id?: number | null
          old_status_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          status_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cow_statuses_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "analytics_fertility_legacy_chart"
            referencedColumns: ["livestock_id"]
          },
          {
            foreignKeyName: "cow_statuses_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "cows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cow_statuses_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "livestock_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      cow_sync_details: {
        Row: {
          cow_sync_id: number | null
          created_at: string
          date_time: string | null
          deleted_date: string | null
          deleted_user_id: number | null
          id: number
          injection_date_time: string | null
          injection_description: string | null
          injection_registered_date: string | null
          injection_registered_user_id: number | null
          injector_user_id: number | null
          is_deleted: boolean
          medicine_id: number | null
          old_cow_sync_id: number | null
          old_id: number | null
          old_medicine_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          status: number | null
          updated_at: string
        }
        Insert: {
          cow_sync_id?: number | null
          created_at?: string
          date_time?: string | null
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          injection_date_time?: string | null
          injection_description?: string | null
          injection_registered_date?: string | null
          injection_registered_user_id?: number | null
          injector_user_id?: number | null
          is_deleted?: boolean
          medicine_id?: number | null
          old_cow_sync_id?: number | null
          old_id?: number | null
          old_medicine_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          status?: number | null
          updated_at?: string
        }
        Update: {
          cow_sync_id?: number | null
          created_at?: string
          date_time?: string | null
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          injection_date_time?: string | null
          injection_description?: string | null
          injection_registered_date?: string | null
          injection_registered_user_id?: number | null
          injector_user_id?: number | null
          is_deleted?: boolean
          medicine_id?: number | null
          old_cow_sync_id?: number | null
          old_id?: number | null
          old_medicine_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          status?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cow_sync_details_cow_sync_id_fkey"
            columns: ["cow_sync_id"]
            isOneToOne: false
            referencedRelation: "cow_syncs"
            referencedColumns: ["id"]
          },
        ]
      }
      cow_syncs: {
        Row: {
          cow_id: number | null
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          description: string | null
          event_date: string | null
          id: number
          inoculation_date_time: string | null
          is_deleted: boolean
          old_cow_id: number | null
          old_id: number | null
          old_sync_type_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          status: number | null
          stop_date: string | null
          stop_description: string | null
          stop_registered_date: string | null
          stop_registered_user_id: number | null
          sync_type_id: number | null
          updated_at: string
        }
        Insert: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          description?: string | null
          event_date?: string | null
          id?: number
          inoculation_date_time?: string | null
          is_deleted?: boolean
          old_cow_id?: number | null
          old_id?: number | null
          old_sync_type_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          status?: number | null
          stop_date?: string | null
          stop_description?: string | null
          stop_registered_date?: string | null
          stop_registered_user_id?: number | null
          sync_type_id?: number | null
          updated_at?: string
        }
        Update: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          description?: string | null
          event_date?: string | null
          id?: number
          inoculation_date_time?: string | null
          is_deleted?: boolean
          old_cow_id?: number | null
          old_id?: number | null
          old_sync_type_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          status?: number | null
          stop_date?: string | null
          stop_description?: string | null
          stop_registered_date?: string | null
          stop_registered_user_id?: number | null
          sync_type_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cow_syncs_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "analytics_fertility_legacy_chart"
            referencedColumns: ["livestock_id"]
          },
          {
            foreignKeyName: "cow_syncs_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "cows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cow_syncs_sync_type_id_fkey"
            columns: ["sync_type_id"]
            isOneToOne: false
            referencedRelation: "sync_types"
            referencedColumns: ["id"]
          },
        ]
      }
      cow_types: {
        Row: {
          cow_id: number | null
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          event_date: string | null
          id: number
          is_deleted: boolean
          old_cow_id: number | null
          old_id: number | null
          old_type_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          type_id: number | null
          updated_at: string
        }
        Insert: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          event_date?: string | null
          id?: number
          is_deleted?: boolean
          old_cow_id?: number | null
          old_id?: number | null
          old_type_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          type_id?: number | null
          updated_at?: string
        }
        Update: {
          cow_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          event_date?: string | null
          id?: number
          is_deleted?: boolean
          old_cow_id?: number | null
          old_id?: number | null
          old_type_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          type_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cow_types_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "analytics_fertility_legacy_chart"
            referencedColumns: ["livestock_id"]
          },
          {
            foreignKeyName: "cow_types_cow_id_fkey"
            columns: ["cow_id"]
            isOneToOne: false
            referencedRelation: "cows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cow_types_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "livestock_types"
            referencedColumns: ["id"]
          },
        ]
      }
      cows: {
        Row: {
          birth_status: number | null
          birth_weight: number | null
          bodynumber: number | null
          created_at: string
          current_live_weight: number | null
          current_meat_weight: number | null
          date_of_birth: string | null
          description: string | null
          earnumber: number | null
          end_date_of_calf_milk: string | null
          existancestatus: number | null
          existancestatusdes: string | null
          existence_date: string | null
          existence_description: string | null
          father_id: number | null
          father_sperm_id: number | null
          id: number
          is_dry: boolean | null
          is_pregnancy: boolean | null
          last_abortion_date: string | null
          last_birth_date: string | null
          last_burn_horn_date: string | null
          last_burn_horn_details: string | null
          last_clean_test_date: string | null
          last_daily_milk_total: number | null
          last_dry_date: string | null
          last_erotic_date: string | null
          last_fertility_status: number | null
          last_fertility_status_date: string | null
          last_hoof_trimming_date: string | null
          last_hoof_trimming_details: string | null
          last_inoculation_date: string | null
          last_location_date: string | null
          last_location_id: number | null
          last_magnet_eating_date: string | null
          last_magnet_eating_details: string | null
          last_milk_amount: number | null
          last_milk_record_date: string | null
          last_out_abortion_date: string | null
          last_out_birth_date: string | null
          last_out_dry_date: string | null
          last_out_period: number | null
          last_period: number | null
          last_physical_status_date: string | null
          last_pregnancy_date: string | null
          last_rinse_date: string | null
          last_status_date: string | null
          last_status_id: number | null
          last_sync_date: string | null
          last_type_date: string | null
          last_type_id: number | null
          mother_id: number | null
          number_of_births: number | null
          number_of_daughter: number | null
          number_of_deaths: number | null
          number_of_son: number | null
          old_father_sperm_id: number | null
          old_id: number | null
          old_last_location_id: number | null
          old_last_status_id: number | null
          old_last_type_id: number | null
          place_of_birth: number | null
          pre_entry_abortion_date: string | null
          pre_entry_birth_date: string | null
          pre_entry_dry_date: string | null
          pre_entry_note: string | null
          pre_entry_period: number | null
          presence_status: number | null
          purchase_date: string | null
          purchase_invoice_number: string | null
          purchase_price: number | null
          sex: number | null
          sextype: string | null
          start_date_of_calf_milk: string | null
          supplier: string | null
          tag_number: string | null
          type_mother_inoculation: boolean | null
          updated_at: string
        }
        Insert: {
          birth_status?: number | null
          birth_weight?: number | null
          bodynumber?: number | null
          created_at?: string
          current_live_weight?: number | null
          current_meat_weight?: number | null
          date_of_birth?: string | null
          description?: string | null
          earnumber?: number | null
          end_date_of_calf_milk?: string | null
          existancestatus?: number | null
          existancestatusdes?: string | null
          existence_date?: string | null
          existence_description?: string | null
          father_id?: number | null
          father_sperm_id?: number | null
          id: number
          is_dry?: boolean | null
          is_pregnancy?: boolean | null
          last_abortion_date?: string | null
          last_birth_date?: string | null
          last_burn_horn_date?: string | null
          last_burn_horn_details?: string | null
          last_clean_test_date?: string | null
          last_daily_milk_total?: number | null
          last_dry_date?: string | null
          last_erotic_date?: string | null
          last_fertility_status?: number | null
          last_fertility_status_date?: string | null
          last_hoof_trimming_date?: string | null
          last_hoof_trimming_details?: string | null
          last_inoculation_date?: string | null
          last_location_date?: string | null
          last_location_id?: number | null
          last_magnet_eating_date?: string | null
          last_magnet_eating_details?: string | null
          last_milk_amount?: number | null
          last_milk_record_date?: string | null
          last_out_abortion_date?: string | null
          last_out_birth_date?: string | null
          last_out_dry_date?: string | null
          last_out_period?: number | null
          last_period?: number | null
          last_physical_status_date?: string | null
          last_pregnancy_date?: string | null
          last_rinse_date?: string | null
          last_status_date?: string | null
          last_status_id?: number | null
          last_sync_date?: string | null
          last_type_date?: string | null
          last_type_id?: number | null
          mother_id?: number | null
          number_of_births?: number | null
          number_of_daughter?: number | null
          number_of_deaths?: number | null
          number_of_son?: number | null
          old_father_sperm_id?: number | null
          old_id?: number | null
          old_last_location_id?: number | null
          old_last_status_id?: number | null
          old_last_type_id?: number | null
          place_of_birth?: number | null
          pre_entry_abortion_date?: string | null
          pre_entry_birth_date?: string | null
          pre_entry_dry_date?: string | null
          pre_entry_note?: string | null
          pre_entry_period?: number | null
          presence_status?: number | null
          purchase_date?: string | null
          purchase_invoice_number?: string | null
          purchase_price?: number | null
          sex?: number | null
          sextype?: string | null
          start_date_of_calf_milk?: string | null
          supplier?: string | null
          tag_number?: string | null
          type_mother_inoculation?: boolean | null
          updated_at?: string
        }
        Update: {
          birth_status?: number | null
          birth_weight?: number | null
          bodynumber?: number | null
          created_at?: string
          current_live_weight?: number | null
          current_meat_weight?: number | null
          date_of_birth?: string | null
          description?: string | null
          earnumber?: number | null
          end_date_of_calf_milk?: string | null
          existancestatus?: number | null
          existancestatusdes?: string | null
          existence_date?: string | null
          existence_description?: string | null
          father_id?: number | null
          father_sperm_id?: number | null
          id?: number
          is_dry?: boolean | null
          is_pregnancy?: boolean | null
          last_abortion_date?: string | null
          last_birth_date?: string | null
          last_burn_horn_date?: string | null
          last_burn_horn_details?: string | null
          last_clean_test_date?: string | null
          last_daily_milk_total?: number | null
          last_dry_date?: string | null
          last_erotic_date?: string | null
          last_fertility_status?: number | null
          last_fertility_status_date?: string | null
          last_hoof_trimming_date?: string | null
          last_hoof_trimming_details?: string | null
          last_inoculation_date?: string | null
          last_location_date?: string | null
          last_location_id?: number | null
          last_magnet_eating_date?: string | null
          last_magnet_eating_details?: string | null
          last_milk_amount?: number | null
          last_milk_record_date?: string | null
          last_out_abortion_date?: string | null
          last_out_birth_date?: string | null
          last_out_dry_date?: string | null
          last_out_period?: number | null
          last_period?: number | null
          last_physical_status_date?: string | null
          last_pregnancy_date?: string | null
          last_rinse_date?: string | null
          last_status_date?: string | null
          last_status_id?: number | null
          last_sync_date?: string | null
          last_type_date?: string | null
          last_type_id?: number | null
          mother_id?: number | null
          number_of_births?: number | null
          number_of_daughter?: number | null
          number_of_deaths?: number | null
          number_of_son?: number | null
          old_father_sperm_id?: number | null
          old_id?: number | null
          old_last_location_id?: number | null
          old_last_status_id?: number | null
          old_last_type_id?: number | null
          place_of_birth?: number | null
          pre_entry_abortion_date?: string | null
          pre_entry_birth_date?: string | null
          pre_entry_dry_date?: string | null
          pre_entry_note?: string | null
          pre_entry_period?: number | null
          presence_status?: number | null
          purchase_date?: string | null
          purchase_invoice_number?: string | null
          purchase_price?: number | null
          sex?: number | null
          sextype?: string | null
          start_date_of_calf_milk?: string | null
          supplier?: string | null
          tag_number?: string | null
          type_mother_inoculation?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cows_father_sperm_id_fkey"
            columns: ["father_sperm_id"]
            isOneToOne: false
            referencedRelation: "sperms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cows_last_location_id_fkey"
            columns: ["last_location_id"]
            isOneToOne: false
            referencedRelation: "livestock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cows_last_status_id_fkey"
            columns: ["last_status_id"]
            isOneToOne: false
            referencedRelation: "livestock_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cows_last_type_id_fkey"
            columns: ["last_type_id"]
            isOneToOne: false
            referencedRelation: "livestock_types"
            referencedColumns: ["id"]
          },
        ]
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
      factor_accounting_map: {
        Row: {
          account_code: string
          account_label: string | null
          created_at: string
          created_by: string | null
          dl_source: string | null
          effective_from: string | null
          effective_to: string | null
          factor_type: string
          id: string
          is_active: boolean
          line_role: Database["public"]["Enums"]["line_role"]
          notes: string | null
          priority: number
          product_type: string
          scenario_key: string
          side: string
          static_dl_ref: number | null
          static_tf_ref: number | null
          tf_source: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_code: string
          account_label?: string | null
          created_at?: string
          created_by?: string | null
          dl_source?: string | null
          effective_from?: string | null
          effective_to?: string | null
          factor_type: string
          id?: string
          is_active?: boolean
          line_role: Database["public"]["Enums"]["line_role"]
          notes?: string | null
          priority?: number
          product_type: string
          scenario_key?: string
          side: string
          static_dl_ref?: number | null
          static_tf_ref?: number | null
          tf_source?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_code?: string
          account_label?: string | null
          created_at?: string
          created_by?: string | null
          dl_source?: string | null
          effective_from?: string | null
          effective_to?: string | null
          factor_type?: string
          id?: string
          is_active?: boolean
          line_role?: Database["public"]["Enums"]["line_role"]
          notes?: string | null
          priority?: number
          product_type?: string
          scenario_key?: string
          side?: string
          static_dl_ref?: number | null
          static_tf_ref?: number | null
          tf_source?: string | null
          updated_at?: string
          updated_by?: string | null
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
      factor_engine_config: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      factor_engine_config_versions: {
        Row: {
          notes: string | null
          payload: Json
          published_at: string
          published_by: string | null
          version: number
        }
        Insert: {
          notes?: string | null
          payload: Json
          published_at?: string
          published_by?: string | null
          version: number
        }
        Update: {
          notes?: string | null
          payload?: Json
          published_at?: string
          published_by?: string | null
          version?: number
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
      factor_posting_attempts: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          factor_id: string
          id: string
          idempotency_key: string | null
          request_payload: Json | null
          response_payload: Json | null
          success: boolean | null
          voucher_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          factor_id: string
          id?: string
          idempotency_key?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          success?: boolean | null
          voucher_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          factor_id?: string
          id?: string
          idempotency_key?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          success?: boolean | null
          voucher_id?: string | null
        }
        Relationships: []
      }
      factor_state_transitions: {
        Row: {
          actor_user_id: string | null
          created_at: string
          factor_id: string
          from_state: string | null
          id: string
          metadata: Json | null
          reason: string | null
          to_state: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          factor_id: string
          from_state?: string | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          to_state: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          factor_id?: string
          from_state?: string | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          to_state?: string
        }
        Relationships: []
      }
      factors: {
        Row: {
          approved_at: string | null
          approved_by: string | null
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
          idempotency_key: string | null
          image: string | null
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string
          last_posting_attempted_at: string | null
          last_posting_error: string | null
          lifecycle_state: string | null
          next_retry_at: string | null
          off_percent: number | null
          other_center_address: string | null
          other_center_description: string | null
          other_center_name: string | null
          other_center_phone: string | null
          payable_amount: number | null
          posting_attempt_count: number | null
          posting_locked_at: string | null
          posting_locked_by: string | null
          product_type: string
          product_type_id: number | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reversal_voucher_id: string | null
          seller_buyer_type: number | null
          sepidar_voucher_id: string | null
          sepidar_voucher_number: string | null
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
          voucher_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
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
          idempotency_key?: string | null
          image?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type: string
          last_posting_attempted_at?: string | null
          last_posting_error?: string | null
          lifecycle_state?: string | null
          next_retry_at?: string | null
          off_percent?: number | null
          other_center_address?: string | null
          other_center_description?: string | null
          other_center_name?: string | null
          other_center_phone?: string | null
          payable_amount?: number | null
          posting_attempt_count?: number | null
          posting_locked_at?: string | null
          posting_locked_by?: string | null
          product_type: string
          product_type_id?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversal_voucher_id?: string | null
          seller_buyer_type?: number | null
          sepidar_voucher_id?: string | null
          sepidar_voucher_number?: string | null
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
          voucher_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
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
          idempotency_key?: string | null
          image?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string
          last_posting_attempted_at?: string | null
          last_posting_error?: string | null
          lifecycle_state?: string | null
          next_retry_at?: string | null
          off_percent?: number | null
          other_center_address?: string | null
          other_center_description?: string | null
          other_center_name?: string | null
          other_center_phone?: string | null
          payable_amount?: number | null
          posting_attempt_count?: number | null
          posting_locked_at?: string | null
          posting_locked_by?: string | null
          product_type?: string
          product_type_id?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversal_voucher_id?: string | null
          seller_buyer_type?: number | null
          sepidar_voucher_id?: string | null
          sepidar_voucher_number?: string | null
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
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_factors_reversal_voucher_id"
            columns: ["reversal_voucher_id"]
            isOneToOne: false
            referencedRelation: "finance_vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_factors_voucher_id"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "finance_vouchers"
            referencedColumns: ["id"]
          },
        ]
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
      finance_account_mappings: {
        Row: {
          account_id: string | null
          amount_source: string | null
          created_at: string
          dl_source: string | null
          dl_static_ref: string | null
          factor_type_id: string | null
          id: string
          is_active: boolean
          leg_code: string
          priority: number
          product_type: string | null
          scope: string
          sign: string | null
          tf_source: string | null
          tf_static_ref: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount_source?: string | null
          created_at?: string
          dl_source?: string | null
          dl_static_ref?: string | null
          factor_type_id?: string | null
          id?: string
          is_active?: boolean
          leg_code: string
          priority?: number
          product_type?: string | null
          scope: string
          sign?: string | null
          tf_source?: string | null
          tf_static_ref?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount_source?: string | null
          created_at?: string
          dl_source?: string | null
          dl_static_ref?: string | null
          factor_type_id?: string | null
          id?: string
          is_active?: boolean
          leg_code?: string
          priority?: number
          product_type?: string | null
          scope?: string
          sign?: string | null
          tf_source?: string | null
          tf_static_ref?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      finance_bank_import_templates: {
        Row: {
          bank_name_code: number | null
          created_at: string
          creditor_amount_column_index: number | null
          date_column_index: number | null
          debtor_amount_column_index: number | null
          description: string | null
          description_column_indexes: number[]
          doc_number_column_index: number | null
          file_type: string
          has_header: boolean
          id: string
          is_active: boolean
          needs_rtl_cleanup: boolean
          row_validation_column_index: number | null
          time_24_fix: boolean
          time_column_index: number | null
          title: string
          updated_at: string
        }
        Insert: {
          bank_name_code?: number | null
          created_at?: string
          creditor_amount_column_index?: number | null
          date_column_index?: number | null
          debtor_amount_column_index?: number | null
          description?: string | null
          description_column_indexes?: number[]
          doc_number_column_index?: number | null
          file_type: string
          has_header?: boolean
          id?: string
          is_active?: boolean
          needs_rtl_cleanup?: boolean
          row_validation_column_index?: number | null
          time_24_fix?: boolean
          time_column_index?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          bank_name_code?: number | null
          created_at?: string
          creditor_amount_column_index?: number | null
          date_column_index?: number | null
          debtor_amount_column_index?: number | null
          description?: string | null
          description_column_indexes?: number[]
          doc_number_column_index?: number | null
          file_type?: string
          has_header?: boolean
          id?: string
          is_active?: boolean
          needs_rtl_cleanup?: boolean
          row_validation_column_index?: number | null
          time_24_fix?: boolean
          time_column_index?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_bank_transactions: {
        Row: {
          amount: number | null
          assigned_operation_id: string | null
          assigned_operation_type: string | null
          assignment_status: string | null
          balance_after: number | null
          bank_id: string | null
          card_number: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deposit_amount: number | null
          description: string | null
          document_number: string | null
          fee_amount: number | null
          id: string
          imported_at: string | null
          imported_by: string | null
          imported_file_name: string | null
          imported_file_path: string | null
          is_deleted: boolean | null
          last_four_digits_card_number: string | null
          legacy_id: number | null
          match_bank_name: string | null
          match_content: string | null
          match_name: string | null
          match_type: number | null
          original_file_name: string | null
          raw_data: Json | null
          reference_number: string | null
          source_type: string | null
          tracking_number: string | null
          transaction_datetime: string | null
          transaction_jalali_date: string | null
          transaction_type: string | null
          updated_at: string
          withdraw_amount: number | null
        }
        Insert: {
          amount?: number | null
          assigned_operation_id?: string | null
          assigned_operation_type?: string | null
          assignment_status?: string | null
          balance_after?: number | null
          bank_id?: string | null
          card_number?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deposit_amount?: number | null
          description?: string | null
          document_number?: string | null
          fee_amount?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          imported_file_name?: string | null
          imported_file_path?: string | null
          is_deleted?: boolean | null
          last_four_digits_card_number?: string | null
          legacy_id?: number | null
          match_bank_name?: string | null
          match_content?: string | null
          match_name?: string | null
          match_type?: number | null
          original_file_name?: string | null
          raw_data?: Json | null
          reference_number?: string | null
          source_type?: string | null
          tracking_number?: string | null
          transaction_datetime?: string | null
          transaction_jalali_date?: string | null
          transaction_type?: string | null
          updated_at?: string
          withdraw_amount?: number | null
        }
        Update: {
          amount?: number | null
          assigned_operation_id?: string | null
          assigned_operation_type?: string | null
          assignment_status?: string | null
          balance_after?: number | null
          bank_id?: string | null
          card_number?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deposit_amount?: number | null
          description?: string | null
          document_number?: string | null
          fee_amount?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          imported_file_name?: string | null
          imported_file_path?: string | null
          is_deleted?: boolean | null
          last_four_digits_card_number?: string | null
          legacy_id?: number | null
          match_bank_name?: string | null
          match_content?: string | null
          match_name?: string | null
          match_type?: number | null
          original_file_name?: string | null
          raw_data?: Json | null
          reference_number?: string | null
          source_type?: string | null
          tracking_number?: string | null
          transaction_datetime?: string | null
          transaction_jalali_date?: string | null
          transaction_type?: string | null
          updated_at?: string
          withdraw_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_bank_transactions_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "finance_banks"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_bank_transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          fee_amount: number | null
          fee_party_id: string | null
          from_amount: number | null
          from_bank_id: string | null
          from_transaction_id: string | null
          has_fee: boolean | null
          id: string
          is_deleted: boolean | null
          legacy_id: number | null
          status: string | null
          to_amount: number | null
          to_bank_id: string | null
          to_transaction_id: string | null
          transfer_datetime: string | null
          updated_at: string
          voucher_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          fee_amount?: number | null
          fee_party_id?: string | null
          from_amount?: number | null
          from_bank_id?: string | null
          from_transaction_id?: string | null
          has_fee?: boolean | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          status?: string | null
          to_amount?: number | null
          to_bank_id?: string | null
          to_transaction_id?: string | null
          transfer_datetime?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          fee_amount?: number | null
          fee_party_id?: string | null
          from_amount?: number | null
          from_bank_id?: string | null
          from_transaction_id?: string | null
          has_fee?: boolean | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          status?: string | null
          to_amount?: number | null
          to_bank_id?: string | null
          to_transaction_id?: string | null
          transfer_datetime?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_bank_transfers_fee_party_id_fkey"
            columns: ["fee_party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_from_bank_id_fkey"
            columns: ["from_bank_id"]
            isOneToOne: false
            referencedRelation: "finance_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_from_transaction_id_fkey"
            columns: ["from_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_to_bank_id_fkey"
            columns: ["to_bank_id"]
            isOneToOne: false
            referencedRelation: "finance_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bank_transfers_to_transaction_id_fkey"
            columns: ["to_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_banks: {
        Row: {
          account_holder_name: string | null
          account_number: string | null
          api_start_date: string | null
          bank_name: string | null
          card_number: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          iban_number: string | null
          id: string
          import_template_id: string | null
          is_active: boolean | null
          is_api_enabled: boolean | null
          is_cheque: boolean | null
          is_deleted: boolean | null
          is_official: boolean | null
          last_balance: number | null
          last_update: string | null
          legacy_bank_name_code: number | null
          legacy_id: number | null
          notes: string | null
          old_balance: number | null
          online_balance: number | null
          sepidar_account_id: number | null
          sepidar_bank_account_id: number | null
          sepidar_dl_code: string | null
          sepidar_dl_id: number | null
          sepidar_full_title: string | null
          sepidar_last_checked_at: string | null
          sepidar_mapping_note: string | null
          sepidar_mapping_status: string
          title: string | null
          unassigned_creditor_balance: number
          unassigned_debtor_balance: number
          updated_at: string
        }
        Insert: {
          account_holder_name?: string | null
          account_number?: string | null
          api_start_date?: string | null
          bank_name?: string | null
          card_number?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          iban_number?: string | null
          id?: string
          import_template_id?: string | null
          is_active?: boolean | null
          is_api_enabled?: boolean | null
          is_cheque?: boolean | null
          is_deleted?: boolean | null
          is_official?: boolean | null
          last_balance?: number | null
          last_update?: string | null
          legacy_bank_name_code?: number | null
          legacy_id?: number | null
          notes?: string | null
          old_balance?: number | null
          online_balance?: number | null
          sepidar_account_id?: number | null
          sepidar_bank_account_id?: number | null
          sepidar_dl_code?: string | null
          sepidar_dl_id?: number | null
          sepidar_full_title?: string | null
          sepidar_last_checked_at?: string | null
          sepidar_mapping_note?: string | null
          sepidar_mapping_status?: string
          title?: string | null
          unassigned_creditor_balance?: number
          unassigned_debtor_balance?: number
          updated_at?: string
        }
        Update: {
          account_holder_name?: string | null
          account_number?: string | null
          api_start_date?: string | null
          bank_name?: string | null
          card_number?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          iban_number?: string | null
          id?: string
          import_template_id?: string | null
          is_active?: boolean | null
          is_api_enabled?: boolean | null
          is_cheque?: boolean | null
          is_deleted?: boolean | null
          is_official?: boolean | null
          last_balance?: number | null
          last_update?: string | null
          legacy_bank_name_code?: number | null
          legacy_id?: number | null
          notes?: string | null
          old_balance?: number | null
          online_balance?: number | null
          sepidar_account_id?: number | null
          sepidar_bank_account_id?: number | null
          sepidar_dl_code?: string | null
          sepidar_dl_id?: number | null
          sepidar_full_title?: string | null
          sepidar_last_checked_at?: string | null
          sepidar_mapping_note?: string | null
          sepidar_mapping_status?: string
          title?: string | null
          unassigned_creditor_balance?: number
          unassigned_debtor_balance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_banks_import_template_id_fkey"
            columns: ["import_template_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_import_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_parties: {
        Row: {
          address: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          balance: number | null
          branch_code: string | null
          company_name: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          economic_code: string | null
          first_name: string | null
          id: string
          identification_code: string | null
          is_deleted: boolean | null
          last_name: string | null
          legacy_id: number | null
          mobile: string | null
          national_code: string | null
          national_id: string | null
          nationality: string | null
          ownership_type: string | null
          party_account_sl_ref: number | null
          postal_code: string | null
          raw_legacy_status: Json | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          request_balance: number | null
          sepidar_account_id: number | null
          sepidar_dl_code: number | null
          sepidar_dl_id: number | null
          sepidar_error_message: string | null
          sepidar_full_name: string | null
          sepidar_party_id: number | null
          sepidar_sync_attempts: number
          sepidar_sync_status: string | null
          sepidar_synced_at: string | null
          status: string | null
          telephone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          balance?: number | null
          branch_code?: string | null
          company_name?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          economic_code?: string | null
          first_name?: string | null
          id?: string
          identification_code?: string | null
          is_deleted?: boolean | null
          last_name?: string | null
          legacy_id?: number | null
          mobile?: string | null
          national_code?: string | null
          national_id?: string | null
          nationality?: string | null
          ownership_type?: string | null
          party_account_sl_ref?: number | null
          postal_code?: string | null
          raw_legacy_status?: Json | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          request_balance?: number | null
          sepidar_account_id?: number | null
          sepidar_dl_code?: number | null
          sepidar_dl_id?: number | null
          sepidar_error_message?: string | null
          sepidar_full_name?: string | null
          sepidar_party_id?: number | null
          sepidar_sync_attempts?: number
          sepidar_sync_status?: string | null
          sepidar_synced_at?: string | null
          status?: string | null
          telephone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          balance?: number | null
          branch_code?: string | null
          company_name?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          economic_code?: string | null
          first_name?: string | null
          id?: string
          identification_code?: string | null
          is_deleted?: boolean | null
          last_name?: string | null
          legacy_id?: number | null
          mobile?: string | null
          national_code?: string | null
          national_id?: string | null
          nationality?: string | null
          ownership_type?: string | null
          party_account_sl_ref?: number | null
          postal_code?: string | null
          raw_legacy_status?: Json | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          request_balance?: number | null
          sepidar_account_id?: number | null
          sepidar_dl_code?: number | null
          sepidar_dl_id?: number | null
          sepidar_error_message?: string | null
          sepidar_full_name?: string | null
          sepidar_party_id?: number | null
          sepidar_sync_attempts?: number
          sepidar_sync_status?: string | null
          sepidar_synced_at?: string | null
          status?: string | null
          telephone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      finance_party_transfers: {
        Row: {
          amount: number | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          from_party_id: string | null
          id: string
          is_deleted: boolean | null
          legacy_id: number | null
          status: string | null
          title: string | null
          to_party_id: string | null
          transfer_datetime: string | null
          updated_at: string
          voucher_id: string | null
        }
        Insert: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          from_party_id?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          status?: string | null
          title?: string | null
          to_party_id?: string | null
          transfer_datetime?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Update: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          from_party_id?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          status?: string | null
          title?: string | null
          to_party_id?: string | null
          transfer_datetime?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_party_transfers_from_party_id_fkey"
            columns: ["from_party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_party_transfers_to_party_id_fkey"
            columns: ["to_party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payment_allocations: {
        Row: {
          allocation_datetime: string
          amount: number
          bank_id: string | null
          bank_transaction_id: string
          created_at: string
          created_by: string | null
          id: string
          is_deleted: boolean
          party_id: string | null
          payment_request_id: string
          payment_request_item_id: string
          sepidar_error_message: string | null
          sepidar_sync_status: string
          status: string
          updated_at: string
          voucher_id: string | null
        }
        Insert: {
          allocation_datetime?: string
          amount: number
          bank_id?: string | null
          bank_transaction_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          party_id?: string | null
          payment_request_id: string
          payment_request_item_id: string
          sepidar_error_message?: string | null
          sepidar_sync_status?: string
          status?: string
          updated_at?: string
          voucher_id?: string | null
        }
        Update: {
          allocation_datetime?: string
          amount?: number
          bank_id?: string | null
          bank_transaction_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          party_id?: string | null
          payment_request_id?: string
          payment_request_item_id?: string
          sepidar_error_message?: string | null
          sepidar_sync_status?: string
          status?: string
          updated_at?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_payment_allocations_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "finance_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_allocations_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_allocations_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_allocations_payment_request_id_fkey"
            columns: ["payment_request_id"]
            isOneToOne: false
            referencedRelation: "finance_payment_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_allocations_payment_request_item_id_fkey"
            columns: ["payment_request_item_id"]
            isOneToOne: false
            referencedRelation: "finance_payment_request_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_allocations_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "finance_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payment_request_items: {
        Row: {
          amount: number | null
          amount_type: string | null
          amount_type_code: number | null
          beneficiary_balance_snapshot: number | null
          beneficiary_id: string | null
          beneficiary_name: string | null
          beneficiary_snapshot_at: string | null
          beneficiary_type: string | null
          confirmed_amount: number | null
          created_at: string
          description: string | null
          dl_code: string | null
          dl_ref: string | null
          id: string
          is_deleted: boolean | null
          legacy_id: number | null
          legacy_request_type_code: number | null
          paid_amount: number
          paid_transaction_id: string | null
          party_id: string | null
          payment_request_id: string | null
          remaining_amount: number | null
          status: string | null
          updated_at: string
          voucher_id: string | null
        }
        Insert: {
          amount?: number | null
          amount_type?: string | null
          amount_type_code?: number | null
          beneficiary_balance_snapshot?: number | null
          beneficiary_id?: string | null
          beneficiary_name?: string | null
          beneficiary_snapshot_at?: string | null
          beneficiary_type?: string | null
          confirmed_amount?: number | null
          created_at?: string
          description?: string | null
          dl_code?: string | null
          dl_ref?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          legacy_request_type_code?: number | null
          paid_amount?: number
          paid_transaction_id?: string | null
          party_id?: string | null
          payment_request_id?: string | null
          remaining_amount?: number | null
          status?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Update: {
          amount?: number | null
          amount_type?: string | null
          amount_type_code?: number | null
          beneficiary_balance_snapshot?: number | null
          beneficiary_id?: string | null
          beneficiary_name?: string | null
          beneficiary_snapshot_at?: string | null
          beneficiary_type?: string | null
          confirmed_amount?: number | null
          created_at?: string
          description?: string | null
          dl_code?: string | null
          dl_ref?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          legacy_request_type_code?: number | null
          paid_amount?: number
          paid_transaction_id?: string | null
          party_id?: string | null
          payment_request_id?: string | null
          remaining_amount?: number | null
          status?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_payment_request_items_paid_transaction_id_fkey"
            columns: ["paid_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_request_items_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payment_request_items_payment_request_id_fkey"
            columns: ["payment_request_id"]
            isOneToOne: false
            referencedRelation: "finance_payment_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payment_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          confirmed_amount: number | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_deleted: boolean | null
          legacy_id: number | null
          legacy_request_type_code: number | null
          payment_status: string
          remaining_amount: number | null
          request_type: string | null
          requested_by: string | null
          status: string | null
          title: string | null
          total_amount: number | null
          total_paid_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          confirmed_amount?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          legacy_request_type_code?: number | null
          payment_status?: string
          remaining_amount?: number | null
          request_type?: string | null
          requested_by?: string | null
          status?: string | null
          title?: string | null
          total_amount?: number | null
          total_paid_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          confirmed_amount?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          legacy_request_type_code?: number | null
          payment_status?: string
          remaining_amount?: number | null
          request_type?: string | null
          requested_by?: string | null
          status?: string | null
          title?: string | null
          total_amount?: number | null
          total_paid_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      finance_receive_identifications: {
        Row: {
          amount: number | null
          approved_at: string | null
          approved_by: string | null
          bank_id: string | null
          bank_transaction_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_deleted: boolean | null
          legacy_id: number | null
          party_id: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          sepidar_error_message: string | null
          sepidar_sync_attempts: number
          sepidar_sync_status: string | null
          status: string | null
          title: string | null
          transaction_datetime: string | null
          updated_at: string
          voucher_id: string | null
        }
        Insert: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          bank_id?: string | null
          bank_transaction_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          party_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sepidar_error_message?: string | null
          sepidar_sync_attempts?: number
          sepidar_sync_status?: string | null
          status?: string | null
          title?: string | null
          transaction_datetime?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Update: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          bank_id?: string | null
          bank_transaction_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean | null
          legacy_id?: number | null
          party_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          sepidar_error_message?: string | null
          sepidar_sync_attempts?: number
          sepidar_sync_status?: string | null
          status?: string | null
          title?: string | null
          transaction_datetime?: string | null
          updated_at?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_receive_identifications_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "finance_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_receive_identifications_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_receive_identifications_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_sepidar_bank_accounts_cache: {
        Row: {
          account_number: string | null
          bank_name: string | null
          created_at: string
          fetched_at: string
          id: string
          is_active: boolean
          raw: Json | null
          sepidar_account_id: number | null
          sepidar_bank_account_id: number
          sepidar_dl_code: string | null
          sepidar_dl_id: number | null
          title: string | null
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          fetched_at?: string
          id?: string
          is_active?: boolean
          raw?: Json | null
          sepidar_account_id?: number | null
          sepidar_bank_account_id: number
          sepidar_dl_code?: string | null
          sepidar_dl_id?: number | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          fetched_at?: string
          id?: string
          is_active?: boolean
          raw?: Json | null
          sepidar_account_id?: number | null
          sepidar_bank_account_id?: number
          sepidar_dl_code?: string | null
          sepidar_dl_id?: number | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      finance_sepidar_logs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          operation: string
          raw_error: string | null
          request_payload: Json | null
          response_payload: Json | null
          success: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          operation: string
          raw_error?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          success?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          operation?: string
          raw_error?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          success?: boolean
        }
        Relationships: []
      }
      finance_sepidar_settings: {
        Row: {
          bridge_base_url: string | null
          bridge_enabled: boolean | null
          created_at: string
          default_bank_fee_party_id: string | null
          default_creditor_payment_account_id: number | null
          default_on_account_payment_account_id: number | null
          default_party_credit_account_id: number | null
          default_party_debit_account_id: number | null
          default_payment_account_id: number | null
          default_prepayment_account_id: number | null
          default_receive_account_id: number | null
          id: string
          sepidar_party_account_sl_ref: number | null
          updated_at: string
        }
        Insert: {
          bridge_base_url?: string | null
          bridge_enabled?: boolean | null
          created_at?: string
          default_bank_fee_party_id?: string | null
          default_creditor_payment_account_id?: number | null
          default_on_account_payment_account_id?: number | null
          default_party_credit_account_id?: number | null
          default_party_debit_account_id?: number | null
          default_payment_account_id?: number | null
          default_prepayment_account_id?: number | null
          default_receive_account_id?: number | null
          id?: string
          sepidar_party_account_sl_ref?: number | null
          updated_at?: string
        }
        Update: {
          bridge_base_url?: string | null
          bridge_enabled?: boolean | null
          created_at?: string
          default_bank_fee_party_id?: string | null
          default_creditor_payment_account_id?: number | null
          default_on_account_payment_account_id?: number | null
          default_party_credit_account_id?: number | null
          default_party_debit_account_id?: number | null
          default_payment_account_id?: number | null
          default_prepayment_account_id?: number | null
          default_receive_account_id?: number | null
          id?: string
          sepidar_party_account_sl_ref?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_sepidar_settings_default_bank_fee_party_id_fkey"
            columns: ["default_bank_fee_party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_sepidar_sync_logs: {
        Row: {
          created_at: string
          entity_type: string | null
          error_message: string | null
          id: string
          operation_type: string | null
          party_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          status: string | null
          voucher_id: string | null
        }
        Insert: {
          created_at?: string
          entity_type?: string | null
          error_message?: string | null
          id?: string
          operation_type?: string | null
          party_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string | null
          voucher_id?: string | null
        }
        Update: {
          created_at?: string
          entity_type?: string | null
          error_message?: string | null
          id?: string
          operation_type?: string | null
          party_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_sepidar_sync_logs_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_sepidar_sync_logs_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "finance_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_voucher_items: {
        Row: {
          account_type: string | null
          bank_id: string | null
          created_at: string
          credit: number | null
          debit: number | null
          description: string | null
          id: string
          party_id: string | null
          row_number: number | null
          sepidar_account_id: number | null
          sepidar_dl_id: number | null
          sepidar_party_id: number | null
          sepidar_voucher_item_id: number | null
          voucher_id: string | null
        }
        Insert: {
          account_type?: string | null
          bank_id?: string | null
          created_at?: string
          credit?: number | null
          debit?: number | null
          description?: string | null
          id?: string
          party_id?: string | null
          row_number?: number | null
          sepidar_account_id?: number | null
          sepidar_dl_id?: number | null
          sepidar_party_id?: number | null
          sepidar_voucher_item_id?: number | null
          voucher_id?: string | null
        }
        Update: {
          account_type?: string | null
          bank_id?: string | null
          created_at?: string
          credit?: number | null
          debit?: number | null
          description?: string | null
          id?: string
          party_id?: string | null
          row_number?: number | null
          sepidar_account_id?: number | null
          sepidar_dl_id?: number | null
          sepidar_party_id?: number | null
          sepidar_voucher_item_id?: number | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_voucher_items_bank_id_fkey"
            columns: ["bank_id"]
            isOneToOne: false
            referencedRelation: "finance_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_voucher_items_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "finance_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_voucher_items_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "finance_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_vouchers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          idempotency_key: string | null
          is_deleted: boolean | null
          legacy_id: number | null
          reversal_of: string | null
          sepidar_daily_number: number | null
          sepidar_error_message: string | null
          sepidar_extra_data_id: number | null
          sepidar_reference_number: number | null
          sepidar_sync_attempts: number | null
          sepidar_sync_status: string | null
          sepidar_synced_at: string | null
          sepidar_voucher_id: number | null
          sepidar_voucher_number: number | null
          source_operation_id: string | null
          source_operation_type: string | null
          status: string | null
          title: string | null
          total_credit: number | null
          total_debit: number | null
          updated_at: string
          voucher_date: string | null
          voucher_number: number | null
          voucher_type: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          idempotency_key?: string | null
          is_deleted?: boolean | null
          legacy_id?: number | null
          reversal_of?: string | null
          sepidar_daily_number?: number | null
          sepidar_error_message?: string | null
          sepidar_extra_data_id?: number | null
          sepidar_reference_number?: number | null
          sepidar_sync_attempts?: number | null
          sepidar_sync_status?: string | null
          sepidar_synced_at?: string | null
          sepidar_voucher_id?: number | null
          sepidar_voucher_number?: number | null
          source_operation_id?: string | null
          source_operation_type?: string | null
          status?: string | null
          title?: string | null
          total_credit?: number | null
          total_debit?: number | null
          updated_at?: string
          voucher_date?: string | null
          voucher_number?: number | null
          voucher_type?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          idempotency_key?: string | null
          is_deleted?: boolean | null
          legacy_id?: number | null
          reversal_of?: string | null
          sepidar_daily_number?: number | null
          sepidar_error_message?: string | null
          sepidar_extra_data_id?: number | null
          sepidar_reference_number?: number | null
          sepidar_sync_attempts?: number | null
          sepidar_sync_status?: string | null
          sepidar_synced_at?: string | null
          sepidar_voucher_id?: number | null
          sepidar_voucher_number?: number | null
          source_operation_id?: string | null
          source_operation_type?: string | null
          status?: string | null
          title?: string | null
          total_credit?: number | null
          total_debit?: number | null
          updated_at?: string
          voucher_date?: string | null
          voucher_number?: number | null
          voucher_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_finance_vouchers_reversal_of"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "finance_vouchers"
            referencedColumns: ["id"]
          },
        ]
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
      livestock_groups: {
        Row: {
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          id: number
          is_active: boolean
          is_deleted: boolean
          name: string
          old_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          name: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Relationships: []
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
      livestock_list_archives: {
        Row: {
          column_keys: string[]
          cow_count: number
          cow_ids: number[]
          created_at: string
          created_by_name: string | null
          created_by_user_id: string | null
          created_by_username: string | null
          filters: Json
          id: string
          name: string
          note: string | null
          updated_at: string
        }
        Insert: {
          column_keys?: string[]
          cow_count?: number
          cow_ids?: number[]
          created_at?: string
          created_by_name?: string | null
          created_by_user_id?: string | null
          created_by_username?: string | null
          filters?: Json
          id?: string
          name: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          column_keys?: string[]
          cow_count?: number
          cow_ids?: number[]
          created_at?: string
          created_by_name?: string | null
          created_by_user_id?: string | null
          created_by_username?: string | null
          filters?: Json
          id?: string
          name?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      livestock_locations: {
        Row: {
          code: number | null
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          desirable_capacity: number | null
          id: number
          is_active: boolean
          is_deleted: boolean
          length: number | null
          max_capacity: number | null
          name: string
          old_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          updated_at: string
          width: number | null
        }
        Insert: {
          code?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          desirable_capacity?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          length?: number | null
          max_capacity?: number | null
          name: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          code?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          desirable_capacity?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          length?: number | null
          max_capacity?: number | null
          name?: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
          width?: number | null
        }
        Relationships: []
      }
      livestock_milk_records: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_user_id: number | null
          created_at: string
          description: string | null
          id: number
          is_cancelled: boolean
          livestock_id: number
          milk_amount: number
          period: number
          record_date: string
          registered_at: string
          registered_user_id: number | null
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_user_id?: number | null
          created_at?: string
          description?: string | null
          id?: number
          is_cancelled?: boolean
          livestock_id: number
          milk_amount: number
          period: number
          record_date: string
          registered_at?: string
          registered_user_id?: number | null
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_user_id?: number | null
          created_at?: string
          description?: string | null
          id?: number
          is_cancelled?: boolean
          livestock_id?: number
          milk_amount?: number
          period?: number
          record_date?: string
          registered_at?: string
          registered_user_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "livestock_milk_records_livestock_id_fkey"
            columns: ["livestock_id"]
            isOneToOne: false
            referencedRelation: "analytics_fertility_legacy_chart"
            referencedColumns: ["livestock_id"]
          },
          {
            foreignKeyName: "livestock_milk_records_livestock_id_fkey"
            columns: ["livestock_id"]
            isOneToOne: false
            referencedRelation: "cows"
            referencedColumns: ["id"]
          },
        ]
      }
      livestock_physical_statuses: {
        Row: {
          back: number | null
          body_score: number | null
          brisket: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_user_id: string | null
          created_at: string
          description: string | null
          feet_score: number | null
          id: number
          image_path: string | null
          image_url: string | null
          is_cancelled: boolean
          legs_score: number | null
          livestock_id: number
          record_date: string
          registered_at: string
          registered_user_id: string | null
          stature: number | null
          tails_head: number | null
          teat_height: number | null
          udder_height: number | null
          updated_at: string
          weight: number | null
        }
        Insert: {
          back?: number | null
          body_score?: number | null
          brisket?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_user_id?: string | null
          created_at?: string
          description?: string | null
          feet_score?: number | null
          id?: number
          image_path?: string | null
          image_url?: string | null
          is_cancelled?: boolean
          legs_score?: number | null
          livestock_id: number
          record_date: string
          registered_at?: string
          registered_user_id?: string | null
          stature?: number | null
          tails_head?: number | null
          teat_height?: number | null
          udder_height?: number | null
          updated_at?: string
          weight?: number | null
        }
        Update: {
          back?: number | null
          body_score?: number | null
          brisket?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_user_id?: string | null
          created_at?: string
          description?: string | null
          feet_score?: number | null
          id?: number
          image_path?: string | null
          image_url?: string | null
          is_cancelled?: boolean
          legs_score?: number | null
          livestock_id?: number
          record_date?: string
          registered_at?: string
          registered_user_id?: string | null
          stature?: number | null
          tails_head?: number | null
          teat_height?: number | null
          udder_height?: number | null
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "livestock_physical_statuses_livestock_id_fkey"
            columns: ["livestock_id"]
            isOneToOne: false
            referencedRelation: "analytics_fertility_legacy_chart"
            referencedColumns: ["livestock_id"]
          },
          {
            foreignKeyName: "livestock_physical_statuses_livestock_id_fkey"
            columns: ["livestock_id"]
            isOneToOne: false
            referencedRelation: "cows"
            referencedColumns: ["id"]
          },
        ]
      }
      livestock_statuses: {
        Row: {
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          id: number
          is_active: boolean
          is_deleted: boolean
          name: string
          old_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          name: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      livestock_types: {
        Row: {
          category_id: number | null
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          group_id: number | null
          id: number
          is_active: boolean
          is_deleted: boolean
          name: string
          old_group_id: number | null
          old_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          updated_at: string
        }
        Insert: {
          category_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          group_id?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          name: string
          old_group_id?: number | null
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Update: {
          category_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          group_id?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          old_group_id?: number | null
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "livestock_types_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "livestock_groups"
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
      sperm_companies: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name: string
          old_id: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          name: string
          old_id?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string
          old_id?: number | null
          updated_at?: string
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
          company_id: number | null
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          father_id: number | null
          flc: number | null
          id: number
          is_active: boolean
          is_deleted: boolean
          lnms: number | null
          milk: number | null
          mother_id: number | null
          name: string | null
          old_company_id: number | null
          old_id: number | null
          pl: number | null
          registered_date: string | null
          registered_user_id: number | null
          regno: number | null
          sce: number | null
          threshold: number | null
          tpi: number | null
          udc: number | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          company_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          father_id?: number | null
          flc?: number | null
          id: number
          is_active?: boolean
          is_deleted?: boolean
          lnms?: number | null
          milk?: number | null
          mother_id?: number | null
          name?: string | null
          old_company_id?: number | null
          old_id?: number | null
          pl?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          regno?: number | null
          sce?: number | null
          threshold?: number | null
          tpi?: number | null
          udc?: number | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          company_id?: number | null
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          father_id?: number | null
          flc?: number | null
          id?: number
          is_active?: boolean
          is_deleted?: boolean
          lnms?: number | null
          milk?: number | null
          mother_id?: number | null
          name?: string | null
          old_company_id?: number | null
          old_id?: number | null
          pl?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          regno?: number | null
          sce?: number | null
          threshold?: number | null
          tpi?: number | null
          udc?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sperms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "sperm_companies"
            referencedColumns: ["id"]
          },
        ]
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
      sync_type_details: {
        Row: {
          created_at: string
          description: string | null
          id: number
          is_medical: boolean | null
          medicine_id: number | null
          old_id: number | null
          old_medicine_id: number | null
          old_sync_type_id: number | null
          sufficient_amount: number | null
          sync_type_id: number | null
          taking_medication_time: number | null
          taking_medication_type_id: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          is_medical?: boolean | null
          medicine_id?: number | null
          old_id?: number | null
          old_medicine_id?: number | null
          old_sync_type_id?: number | null
          sufficient_amount?: number | null
          sync_type_id?: number | null
          taking_medication_time?: number | null
          taking_medication_type_id?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          is_medical?: boolean | null
          medicine_id?: number | null
          old_id?: number | null
          old_medicine_id?: number | null
          old_sync_type_id?: number | null
          sufficient_amount?: number | null
          sync_type_id?: number | null
          taking_medication_time?: number | null
          taking_medication_type_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_type_details_sync_type_id_fkey"
            columns: ["sync_type_id"]
            isOneToOne: false
            referencedRelation: "sync_types"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_types: {
        Row: {
          created_at: string
          deleted_date: string | null
          deleted_user_id: number | null
          id: number
          inoculation_time: number | null
          is_active: boolean
          is_deleted: boolean
          medicine_and_times: string | null
          name: string
          old_id: number | null
          registered_date: string | null
          registered_user_id: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          inoculation_time?: number | null
          is_active?: boolean
          is_deleted?: boolean
          medicine_and_times?: string | null
          name: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_date?: string | null
          deleted_user_id?: number | null
          id?: number
          inoculation_time?: number | null
          is_active?: boolean
          is_deleted?: boolean
          medicine_and_times?: string | null
          name?: string
          old_id?: number | null
          registered_date?: string | null
          registered_user_id?: number | null
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
      analytics_fertility_legacy_chart: {
        Row: {
          bodynumber: number | null
          chart_status: string | null
          d_birth: string | null
          d_dob: string | null
          d_dry: string | null
          d_erotic: string | null
          d_inoc: string | null
          date_of_birth: string | null
          dry_days: number | null
          earnumber: number | null
          is_dry: boolean | null
          is_heifer: boolean | null
          is_pregnancy: boolean | null
          is_pregnancy_reporting: boolean | null
          last_abortion_date: string | null
          last_birth_date: string | null
          last_birth_to_pregnancy_days: number | null
          last_dry_date: string | null
          last_erotic_date: string | null
          last_fertility_status: number | null
          last_inoculation_date: string | null
          last_location_name: string | null
          last_period: number | null
          last_pregnancy_date: string | null
          livestock_id: number | null
          milking_status: string | null
          number_of_births: number | null
          prediction_of_birth_date: string | null
          prediction_of_birth_date_days: number | null
          pregnancy_days: number | null
          status_color: string | null
        }
        Relationships: []
      }
      v_factor_engine_config_active: {
        Row: {
          payload: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      _log_factor_posting_attempt: {
        Args: {
          p_attempt_number: number
          p_context?: Json
          p_factor_id: string
          p_idempotency_key?: string
          p_message: string
          p_raw_error?: string
          p_step: string
          p_success: boolean
          p_voucher_id?: string
        }
        Returns: string
      }
      ensure_app_users_for_hr_users: {
        Args: { _default_password_hash?: string }
        Returns: {
          created_username: string
          hr_user_id: number
        }[]
      }
      fn_finance_recalc_payment_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      fn_finance_recalc_payment_request_item: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      fn_finance_request_approved_payable: {
        Args: { p_request_id: string }
        Returns: number
      }
      has_app_role: {
        Args: { _role_name: string; _user_id: string }
        Returns: boolean
      }
      post_approved_factor: {
        Args: { p_factor_id: string; p_triggered_by?: string }
        Returns: Json
      }
      rebuild_cow_fertility_cache: {
        Args: { p_cow_id: number }
        Returns: undefined
      }
      rebuild_cow_location_cache: {
        Args: { p_cow_id: number }
        Returns: undefined
      }
      rebuild_cow_milk_cache: { Args: { p_cow_id: number }; Returns: undefined }
      rebuild_cow_physical_cache: {
        Args: { p_cow_id: number }
        Returns: undefined
      }
      rebuild_cow_status_cache: {
        Args: { p_cow_id: number }
        Returns: undefined
      }
      rebuild_cow_type_cache: { Args: { p_cow_id: number }; Returns: undefined }
      safe_text_to_date: { Args: { p_text: string }; Returns: string }
      submit_cow_factor: {
        Args: { p_details: Json; p_factor: Json }
        Returns: Json
      }
      submit_payment_request: {
        Args: { p_items: Json; p_request: Json }
        Returns: string
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
      line_role:
        | "inventory"
        | "ap"
        | "ar"
        | "revenue"
        | "cogs"
        | "freight"
        | "discount"
        | "tax"
        | "rounding"
        | "other"
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
    Enums: {
      line_role: [
        "inventory",
        "ap",
        "ar",
        "revenue",
        "cogs",
        "freight",
        "discount",
        "tax",
        "rounding",
        "other",
      ],
    },
  },
} as const
