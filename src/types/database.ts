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
            foreignKeyName: "import_rows_workspace_id_import_id_fkey"
            columns: ["workspace_id", "import_id"]
            isOneToOne: false
            referencedRelation: "excel_imports"
            referencedColumns: ["workspace_id", "id"]
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
      [_ in never]: never
    }
    Functions: {
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
