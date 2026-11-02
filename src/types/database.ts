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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      excel_import_sheets: {
        Row: {
          column_headers: Json
          created_at: string
          duplicate_rows: number
          header_row_number: number
          id: string
          import_id: string
          invalid_rows: number
          rows_imported: number
          rows_read: number
          selected: boolean
          sheet_index: number
          sheet_name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          column_headers?: Json
          created_at?: string
          duplicate_rows?: number
          header_row_number?: number
          id?: string
          import_id: string
          invalid_rows?: number
          rows_imported?: number
          rows_read?: number
          selected?: boolean
          sheet_index: number
          sheet_name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          column_headers?: Json
          created_at?: string
          duplicate_rows?: number
          header_row_number?: number
          id?: string
          import_id?: string
          invalid_rows?: number
          rows_imported?: number
          rows_read?: number
          selected?: boolean
          sheet_index?: number
          sheet_name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "excel_import_sheets_workspace_id_import_id_fkey"
            columns: ["workspace_id", "import_id"]
            isOneToOne: false
            referencedRelation: "excel_imports"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      excel_imports: {
        Row: {
          archived_at: string | null
          column_mapping: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          duplicate_handling: string
          duplicate_of_import_id: string | null
          duplicate_rows: number
          error_summary: string | null
          failed_rows: number
          file_name: string
          file_sha256: string
          file_size_bytes: number
          file_type: string
          id: string
          idempotency_key: string
          invalid_rows: number
          mime_type: string | null
          new_records: number
          rows_imported: number
          rows_read: number
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          updated_records: number
          worksheet_count: number
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_handling?: string
          duplicate_of_import_id?: string | null
          duplicate_rows?: number
          error_summary?: string | null
          failed_rows?: number
          file_name: string
          file_sha256: string
          file_size_bytes: number
          file_type: string
          id?: string
          idempotency_key: string
          invalid_rows?: number
          mime_type?: string | null
          new_records?: number
          rows_imported?: number
          rows_read?: number
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          updated_records?: number
          worksheet_count?: number
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_handling?: string
          duplicate_of_import_id?: string | null
          duplicate_rows?: number
          error_summary?: string | null
          failed_rows?: number
          file_name?: string
          file_sha256?: string
          file_size_bytes?: number
          file_type?: string
          id?: string
          idempotency_key?: string
          invalid_rows?: number
          mime_type?: string | null
          new_records?: number
          rows_imported?: number
          rows_read?: number
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          updated_records?: number
          worksheet_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "excel_imports_duplicate_of_import_id_fkey"
            columns: ["duplicate_of_import_id"]
            isOneToOne: false
            referencedRelation: "excel_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "excel_imports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          created_at: string
          duplicate_of_row_id: string | null
          error_message: string | null
          id: string
          import_id: string
          issues: Json
          lead_id: string | null
          mapped_data: Json
          normalized_city: string | null
          normalized_company_name: string | null
          normalized_domain: string | null
          normalized_email: string | null
          normalized_phone: string | null
          normalized_state: string | null
          raw_data: Json
          row_number: number
          sheet_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duplicate_of_row_id?: string | null
          error_message?: string | null
          id?: string
          import_id: string
          issues?: Json
          lead_id?: string | null
          mapped_data?: Json
          normalized_city?: string | null
          normalized_company_name?: string | null
          normalized_domain?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          normalized_state?: string | null
          raw_data: Json
          row_number: number
          sheet_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          duplicate_of_row_id?: string | null
          error_message?: string | null
          id?: string
          import_id?: string
          issues?: Json
          lead_id?: string | null
          mapped_data?: Json
          normalized_city?: string | null
          normalized_company_name?: string | null
          normalized_domain?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          normalized_state?: string | null
          raw_data?: Json
          row_number?: number
          sheet_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_duplicate_of_row_id_fkey"
            columns: ["duplicate_of_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_import_id_sheet_id_fkey"
            columns: ["import_id", "sheet_id"]
            isOneToOne: false
            referencedRelation: "excel_import_sheets"
            referencedColumns: ["import_id", "id"]
          },
          {
            foreignKeyName: "import_rows_lead_fkey"
            columns: ["workspace_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "lead_research_summary"
            referencedColumns: ["workspace_id", "lead_id"]
          },
          {
            foreignKeyName: "import_rows_lead_fkey"
            columns: ["workspace_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "import_rows_workspace_id_import_id_fkey"
            columns: ["workspace_id", "import_id"]
            isOneToOne: false
            referencedRelation: "excel_imports"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          content_type: string | null
          created_at: string
          final_url: string | null
          http_status: number | null
          id: string
          lead_id: string
          retrieved_at: string
          run_id: string
          source_name: string | null
          source_type: string
          text_bytes: number | null
          text_chars: number | null
          text_purged_at: string | null
          text_sha256: string | null
          text_storage_path: string | null
          title: string | null
          url: string
          workspace_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          final_url?: string | null
          http_status?: number | null
          id?: string
          lead_id: string
          retrieved_at: string
          run_id: string
          source_name?: string | null
          source_type: string
          text_bytes?: number | null
          text_chars?: number | null
          text_purged_at?: string | null
          text_sha256?: string | null
          text_storage_path?: string | null
          title?: string | null
          url: string
          workspace_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          final_url?: string | null
          http_status?: number | null
          id?: string
          lead_id?: string
          retrieved_at?: string
          run_id?: string
          source_name?: string | null
          source_type?: string
          text_bytes?: number | null
          text_chars?: number | null
          text_purged_at?: string | null
          text_sha256?: string | null
          text_storage_path?: string | null
          title?: string | null
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sources_workspace_id_run_id_lead_id_fkey"
            columns: ["workspace_id", "run_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["workspace_id", "id", "lead_id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          business_email: string | null
          city: string | null
          company_name: string
          country: string | null
          created_at: string
          decision_maker_name: string | null
          decision_maker_title: string | null
          discovered_at: string
          id: string
          lead_score: number | null
          lead_score_reason: string | null
          normalized_city: string | null
          normalized_company_name: string | null
          normalized_domain: string | null
          normalized_email: string | null
          normalized_phone: string | null
          normalized_state: string | null
          notes: string | null
          phone: string | null
          postal_code: string | null
          qualification_status: string
          services: string | null
          source_import_id: string | null
          source_name: string | null
          source_url: string | null
          state: string | null
          suppressed: boolean
          updated_at: string
          verification_status: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          address?: string | null
          business_email?: string | null
          city?: string | null
          company_name: string
          country?: string | null
          created_at?: string
          decision_maker_name?: string | null
          decision_maker_title?: string | null
          discovered_at?: string
          id?: string
          lead_score?: number | null
          lead_score_reason?: string | null
          normalized_city?: string | null
          normalized_company_name?: string | null
          normalized_domain?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          normalized_state?: string | null
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          qualification_status?: string
          services?: string | null
          source_import_id?: string | null
          source_name?: string | null
          source_url?: string | null
          state?: string | null
          suppressed?: boolean
          updated_at?: string
          verification_status?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          address?: string | null
          business_email?: string | null
          city?: string | null
          company_name?: string
          country?: string | null
          created_at?: string
          decision_maker_name?: string | null
          decision_maker_title?: string | null
          discovered_at?: string
          id?: string
          lead_score?: number | null
          lead_score_reason?: string | null
          normalized_city?: string | null
          normalized_company_name?: string | null
          normalized_domain?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          normalized_state?: string | null
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          qualification_status?: string
          services?: string | null
          source_import_id?: string | null
          source_name?: string | null
          source_url?: string | null
          state?: string | null
          suppressed?: boolean
          updated_at?: string
          verification_status?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "excel_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      research_findings: {
        Row: {
          category: string
          confidence: number | null
          created_at: string
          evidence_quote: string | null
          field_key: string
          id: string
          kind: string
          lead_id: string
          quote_check: string | null
          quote_verified_at: string | null
          run_id: string
          source_id: string | null
          supporting_finding_ids: string[]
          value_hash: string | null
          value_json: Json | null
          value_text: string
          workspace_id: string
        }
        Insert: {
          category: string
          confidence?: number | null
          created_at?: string
          evidence_quote?: string | null
          field_key: string
          id?: string
          kind: string
          lead_id: string
          quote_check?: string | null
          quote_verified_at?: string | null
          run_id: string
          source_id?: string | null
          supporting_finding_ids?: string[]
          value_hash?: string | null
          value_json?: Json | null
          value_text: string
          workspace_id: string
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string
          evidence_quote?: string | null
          field_key?: string
          id?: string
          kind?: string
          lead_id?: string
          quote_check?: string | null
          quote_verified_at?: string | null
          run_id?: string
          source_id?: string | null
          supporting_finding_ids?: string[]
          value_hash?: string | null
          value_json?: Json | null
          value_text?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_findings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_findings_workspace_id_run_id_lead_id_fkey"
            columns: ["workspace_id", "run_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["workspace_id", "id", "lead_id"]
          },
          {
            foreignKeyName: "research_findings_workspace_id_run_id_source_id_fkey"
            columns: ["workspace_id", "run_id", "source_id"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["workspace_id", "run_id", "id"]
          },
        ]
      }
      research_run_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          attempt: number | null
          created_at: string
          details: Json
          event_type: string
          id: number
          run_id: string
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          attempt?: number | null
          created_at?: string
          details?: Json
          event_type: string
          id?: never
          run_id: string
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          attempt?: number | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: never
          run_id?: string
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_run_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_run_events_workspace_id_run_id_fkey"
            columns: ["workspace_id", "run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      research_runs: {
        Row: {
          ai_input_tokens: number
          ai_model: string | null
          ai_output_tokens: number
          ai_provider: string | null
          assessments_count: number
          attempts: number
          cancel_requested_at: string | null
          candidates_count: number
          cost_usd: number
          created_at: string
          error_code: string | null
          error_message: string | null
          facts_count: number
          finished_at: string | null
          id: string
          idempotency_key: string
          lead_id: string
          locked_by: string | null
          locked_until: string | null
          max_attempts: number
          next_attempt_at: string
          pages_fetched: number
          pipeline_version: string
          previous_run_id: string | null
          prompt_version: string | null
          queued_at: string
          requested_by: string | null
          sources_count: number
          started_at: string | null
          status: string
          trigger_source: string
          updated_at: string
          warnings: Json
          workspace_id: string
        }
        Insert: {
          ai_input_tokens?: number
          ai_model?: string | null
          ai_output_tokens?: number
          ai_provider?: string | null
          assessments_count?: number
          attempts?: number
          cancel_requested_at?: string | null
          candidates_count?: number
          cost_usd?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          facts_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key: string
          lead_id: string
          locked_by?: string | null
          locked_until?: string | null
          max_attempts?: number
          next_attempt_at?: string
          pages_fetched?: number
          pipeline_version?: string
          previous_run_id?: string | null
          prompt_version?: string | null
          queued_at?: string
          requested_by?: string | null
          sources_count?: number
          started_at?: string | null
          status?: string
          trigger_source?: string
          updated_at?: string
          warnings?: Json
          workspace_id: string
        }
        Update: {
          ai_input_tokens?: number
          ai_model?: string | null
          ai_output_tokens?: number
          ai_provider?: string | null
          assessments_count?: number
          attempts?: number
          cancel_requested_at?: string | null
          candidates_count?: number
          cost_usd?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          facts_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          lead_id?: string
          locked_by?: string | null
          locked_until?: string | null
          max_attempts?: number
          next_attempt_at?: string
          pages_fetched?: number
          pipeline_version?: string
          previous_run_id?: string | null
          prompt_version?: string | null
          queued_at?: string
          requested_by?: string | null
          sources_count?: number
          started_at?: string | null
          status?: string
          trigger_source?: string
          updated_at?: string
          warnings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_runs_workspace_id_lead_id_fkey"
            columns: ["workspace_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "lead_research_summary"
            referencedColumns: ["workspace_id", "lead_id"]
          },
          {
            foreignKeyName: "research_runs_workspace_id_lead_id_fkey"
            columns: ["workspace_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "research_runs_workspace_id_previous_run_id_fkey"
            columns: ["workspace_id", "previous_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      lead_research_summary: {
        Row: {
          active_run_id: string | null
          active_run_status: string | null
          last_finished_run_id: string | null
          last_finished_status: string | null
          last_researched_at: string | null
          last_successful_run_id: string | null
          lead_id: string | null
          research_status: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cancel_research_run: { Args: { p_run_id: string }; Returns: string }
      complete_excel_import: {
        Args: { p_import_id: string }
        Returns: {
          archived_at: string | null
          column_mapping: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          duplicate_handling: string
          duplicate_of_import_id: string | null
          duplicate_rows: number
          error_summary: string | null
          failed_rows: number
          file_name: string
          file_sha256: string
          file_size_bytes: number
          file_type: string
          id: string
          idempotency_key: string
          invalid_rows: number
          mime_type: string | null
          new_records: number
          rows_imported: number
          rows_read: number
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          updated_records: number
          worksheet_count: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "excel_imports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_workspace: {
        Args: { workspace_name: string; workspace_timezone?: string }
        Returns: string
      }
      is_anonymous_user: { Args: never; Returns: boolean }
      lead_overview_metrics: {
        Args: { p_from: string; p_to: string; p_workspace_id: string }
        Returns: {
          new_leads: number
          qualified_leads: number
          total_leads: number
          unique_companies: number
          verified_contacts: number
        }[]
      }
      refresh_excel_import: {
        Args: { p_import_id: string }
        Returns: {
          archived_at: string | null
          column_mapping: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          duplicate_handling: string
          duplicate_of_import_id: string | null
          duplicate_rows: number
          error_summary: string | null
          failed_rows: number
          file_name: string
          file_sha256: string
          file_size_bytes: number
          file_type: string
          id: string
          idempotency_key: string
          invalid_rows: number
          mime_type: string | null
          new_records: number
          rows_imported: number
          rows_read: number
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          updated_records: number
          worksheet_count: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "excel_imports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_lead_research: {
        Args: {
          p_lead_ids: string[]
          p_request_key: string
          p_workspace_id: string
        }
        Returns: {
          lead_id: string
          outcome: string
          run_id: string
        }[]
      }
      research_run_changes: {
        Args: { p_run_id: string }
        Returns: {
          category: string
          change_type: string
          current_finding_id: string
          current_value: string
          field_key: string
          kind: string
          previous_finding_id: string
          previous_value: string
        }[]
      }
      worker_claim_research_runs: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          ai_input_tokens: number
          ai_model: string | null
          ai_output_tokens: number
          ai_provider: string | null
          assessments_count: number
          attempts: number
          cancel_requested_at: string | null
          candidates_count: number
          cost_usd: number
          created_at: string
          error_code: string | null
          error_message: string | null
          facts_count: number
          finished_at: string | null
          id: string
          idempotency_key: string
          lead_id: string
          locked_by: string | null
          locked_until: string | null
          max_attempts: number
          next_attempt_at: string
          pages_fetched: number
          pipeline_version: string
          previous_run_id: string | null
          prompt_version: string | null
          queued_at: string
          requested_by: string | null
          sources_count: number
          started_at: string | null
          status: string
          trigger_source: string
          updated_at: string
          warnings: Json
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "research_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      worker_complete_research_run: {
        Args: { p_result: Json; p_run_id: string; p_worker_id: string }
        Returns: string
      }
      worker_fail_research_run: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_retryable?: boolean
          p_run_id: string
          p_worker_id: string
        }
        Returns: string
      }
      worker_heartbeat_research_run: {
        Args: {
          p_lease_seconds?: number
          p_run_id: string
          p_worker_id: string
        }
        Returns: boolean
      }
      worker_mark_research_text_purged: {
        Args: { p_source_ids: string[] }
        Returns: number
      }
      worker_research_orphan_objects: {
        Args: { p_limit?: number }
        Returns: {
          storage_path: string
        }[]
      }
      worker_research_text_due_for_purge: {
        Args: { p_limit?: number }
        Returns: {
          run_id: string
          source_id: string
          storage_path: string
        }[]
      }
    }
    Enums: {
      workspace_role: "owner" | "admin" | "member"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      workspace_role: ["owner", "admin", "member"],
    },
  },
} as const
