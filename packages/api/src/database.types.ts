export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity: {
        Row: {
          actor_id: string | null
          created_at: string
          data: NonNullable<Json>
          group_id: string
          id: string
          subject_id: string | null
          verb: string
        }
        ComputedFields: never
        Insert: {
          actor_id?: string | null
          created_at?: string
          data?: NonNullable<Json>
          group_id: string
          id?: string
          subject_id?: string | null
          verb: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          data?: NonNullable<Json>
          group_id?: string
          id?: string
          subject_id?: string | null
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: 'activity_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activity_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: NonNullable<Json>
        }
        ComputedFields: never
        Insert: {
          key: string
          updated_at?: string
          value: NonNullable<Json>
        }
        Update: {
          key?: string
          updated_at?: string
          value?: NonNullable<Json>
        }
        Relationships: []
      }
      availability: {
        Row: {
          event_id: string
          level: Database['public']['Enums']['availability_level']
          slot_start: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          event_id: string
          level?: Database['public']['Enums']['availability_level']
          slot_start: string
          user_id: string
        }
        Update: {
          event_id?: string
          level?: Database['public']['Enums']['availability_level']
          slot_start?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'availability_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'availability_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      availability_requests: {
        Row: {
          event_id: string
          requested_at: string
          requested_by: string | null
          responded_at: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          event_id: string
          requested_at?: string
          requested_by?: string | null
          responded_at?: string | null
          user_id: string
        }
        Update: {
          event_id?: string
          requested_at?: string
          requested_by?: string | null
          responded_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'availability_requests_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'availability_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'availability_requests_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        ComputedFields: never
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'blocks_blocked_id_fkey'
            columns: ['blocked_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'blocks_blocker_id_fkey'
            columns: ['blocker_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      busy_blocks: {
        Row: {
          created_at: string
          ends_at: string
          id: number
          source: string
          starts_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          ends_at: string
          id?: never
          source?: string
          starts_at: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: never
          source?: string
          starts_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'busy_blocks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      calendar_connections: {
        Row: {
          access_token_secret_id: string | null
          account_email: string | null
          created_at: string
          id: string
          last_synced_at: string | null
          provider: string
          refresh_token_secret_id: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          access_token_secret_id?: string | null
          account_email?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          provider: string
          refresh_token_secret_id?: string | null
          user_id: string
        }
        Update: {
          access_token_secret_id?: string | null
          account_email?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          provider?: string
          refresh_token_secret_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'calendar_connections_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      calendar_feed_tokens: {
        Row: {
          created_at: string
          token: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'calendar_feed_tokens_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          event_id: string | null
          expense_id: string | null
          group_id: string
          id: string
          settlement_id: string | null
        }
        ComputedFields: never
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          expense_id?: string | null
          group_id: string
          id?: string
          settlement_id?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          expense_id?: string | null
          group_id?: string
          id?: string
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_settlement_id_fkey'
            columns: ['settlement_id']
            isOneToOne: false
            referencedRelation: 'settlements'
            referencedColumns: ['id']
          },
        ]
      }
      debt_reminders: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          from_user: string
          group_id: string
          id: string
          note: string | null
          sent_on: string
          to_user: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          from_user: string
          group_id: string
          id?: string
          note?: string | null
          sent_on?: string
          to_user: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          from_user?: string
          group_id?: string
          id?: string
          note?: string | null
          sent_on?: string
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: 'debt_reminders_from_user_fkey'
            columns: ['from_user']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'debt_reminders_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'debt_reminders_to_user_fkey'
            columns: ['to_user']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      event_guest_availability: {
        Row: {
          event_id: string
          guest_id: string
          level: Database['public']['Enums']['availability_level']
          slot_start: string
        }
        ComputedFields: never
        Insert: {
          event_id: string
          guest_id: string
          level?: Database['public']['Enums']['availability_level']
          slot_start: string
        }
        Update: {
          event_id?: string
          guest_id?: string
          level?: Database['public']['Enums']['availability_level']
          slot_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_guest_availability_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_guest_availability_guest_id_fkey'
            columns: ['guest_id']
            isOneToOne: false
            referencedRelation: 'event_guests'
            referencedColumns: ['id']
          },
        ]
      }
      event_guest_links: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          event_id: string
          expires_at: string
          group_id: string
          id: string
          max_guests: number
          revoked_at: string | null
        }
        ComputedFields: never
        Insert: {
          code?: string
          created_at?: string
          created_by?: string | null
          event_id: string
          expires_at: string
          group_id: string
          id?: string
          max_guests: number
          revoked_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          expires_at?: string
          group_id?: string
          id?: string
          max_guests?: number
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'event_guest_links_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_guest_links_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_guest_links_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
        ]
      }
      event_guests: {
        Row: {
          created_at: string
          display_name: string
          event_id: string
          group_id: string
          id: string
          link_id: string
          removed_at: string | null
          saves: number
          saves_window_start: string
          token_hash: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          display_name: string
          event_id: string
          group_id: string
          id?: string
          link_id: string
          removed_at?: string | null
          saves?: number
          saves_window_start?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          event_id?: string
          group_id?: string
          id?: string
          link_id?: string
          removed_at?: string | null
          saves?: number
          saves_window_start?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_guests_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_guests_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_guests_link_id_fkey'
            columns: ['link_id']
            isOneToOne: false
            referencedRelation: 'event_guest_links'
            referencedColumns: ['id']
          },
        ]
      }
      event_rsvps: {
        Row: {
          event_id: string
          status: Database['public']['Enums']['rsvp_status']
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          event_id: string
          status: Database['public']['Enums']['rsvp_status']
          updated_at?: string
          user_id?: string
        }
        Update: {
          event_id?: string
          status?: Database['public']['Enums']['rsvp_status']
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_rsvps_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_rsvps_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by: string | null
          day_end_minute: number
          day_start_minute: number
          description: string | null
          duration_minutes: number
          emoji: string | null
          ends_at: string | null
          group_id: string
          id: string
          location: string | null
          min_attendees: number
          reminder_sent_at: string | null
          rsvp_deadline: string | null
          slot_minutes: number
          starts_at: string | null
          status: Database['public']['Enums']['event_status']
          timezone: string
          title: string
          updated_at: string
          window_end: string
          window_start: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          day_end_minute?: number
          day_start_minute?: number
          description?: string | null
          duration_minutes?: number
          emoji?: string | null
          ends_at?: string | null
          group_id: string
          id?: string
          location?: string | null
          min_attendees?: number
          reminder_sent_at?: string | null
          rsvp_deadline?: string | null
          slot_minutes?: number
          starts_at?: string | null
          status?: Database['public']['Enums']['event_status']
          timezone?: string
          title: string
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          day_end_minute?: number
          day_start_minute?: number
          description?: string | null
          duration_minutes?: number
          emoji?: string | null
          ends_at?: string | null
          group_id?: string
          id?: string
          location?: string | null
          min_attendees?: number
          reminder_sent_at?: string | null
          rsvp_deadline?: string | null
          slot_minutes?: number
          starts_at?: string | null
          status?: Database['public']['Enums']['event_status']
          timezone?: string
          title?: string
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'events_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'events_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
        ]
      }
      expense_attachments: {
        Row: {
          content_type: string
          created_at: string
          expense_id: string
          group_id: string
          path: string
          position: number
          uploaded_by: string | null
        }
        ComputedFields: never
        Insert: {
          content_type: string
          created_at?: string
          expense_id: string
          group_id: string
          path: string
          position: number
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string
          created_at?: string
          expense_id?: string
          group_id?: string
          path?: string
          position?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'expense_attachments_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expense_attachments_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expense_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      expense_items: {
        Row: {
          amount_cents: number
          description: string
          expense_id: string
          position: number
          user_ids: string[]
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          description?: string
          expense_id: string
          position: number
          user_ids: string[]
        }
        Update: {
          amount_cents?: number
          description?: string
          expense_id?: string
          position?: number
          user_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: 'expense_items_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
        ]
      }
      expense_payers: {
        Row: {
          expense_id: string
          paid_cents: number
          user_id: string
        }
        ComputedFields: never
        Insert: {
          expense_id: string
          paid_cents: number
          user_id: string
        }
        Update: {
          expense_id?: string
          paid_cents?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expense_payers_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expense_payers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      expense_splits: {
        Row: {
          adjustment_cents: number | null
          expense_id: string
          share_cents: number
          user_id: string
          weight: number | null
        }
        ComputedFields: never
        Insert: {
          adjustment_cents?: number | null
          expense_id: string
          share_cents: number
          user_id: string
          weight?: number | null
        }
        Update: {
          adjustment_cents?: number | null
          expense_id?: string
          share_cents?: number
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'expense_splits_expense_id_fkey'
            columns: ['expense_id']
            isOneToOne: false
            referencedRelation: 'expenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expense_splits_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      expenses: {
        Row: {
          amount_cents: number
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          discount_cents: number | null
          event_id: string | null
          fx_rate: number
          group_id: string
          id: string
          is_refund: boolean
          notes: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_type: Database['public']['Enums']['split_type']
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          deleted_at?: string | null
          description: string
          discount_cents?: number | null
          event_id?: string | null
          fx_rate?: number
          group_id: string
          id?: string
          is_refund?: boolean
          notes?: string | null
          paid_by: string
          receipt_path?: string | null
          recurring_id?: string | null
          spent_at?: string
          split_type?: Database['public']['Enums']['split_type']
          tax_cents?: number | null
          tip_cents?: number | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description?: string
          discount_cents?: number | null
          event_id?: string | null
          fx_rate?: number
          group_id?: string
          id?: string
          is_refund?: boolean
          notes?: string | null
          paid_by?: string
          receipt_path?: string | null
          recurring_id?: string | null
          spent_at?: string
          split_type?: Database['public']['Enums']['split_type']
          tax_cents?: number | null
          tip_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'expenses_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_paid_by_fkey'
            columns: ['paid_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_recurring_id_fkey'
            columns: ['recurring_id']
            isOneToOne: false
            referencedRelation: 'recurring_expenses'
            referencedColumns: ['id']
          },
        ]
      }
      friend_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string
          email: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          revoked_at: string | null
          uses: number
        }
        ComputedFields: never
        Insert: {
          code?: string
          created_at?: string
          created_by?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: 'friend_invites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          friend_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          friend_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'friendships_friend_id_fkey'
            columns: ['friend_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'friendships_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      fx_rates: {
        Row: {
          base: string
          day: string
          quote: string
          rate: number
        }
        ComputedFields: never
        Insert: {
          base: string
          day: string
          quote: string
          rate: number
        }
        Update: {
          base?: string
          day?: string
          quote?: string
          rate?: number
        }
        Relationships: []
      }
      group_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          email: string | null
          expires_at: string | null
          group_id: string
          id: string
          max_uses: number | null
          placeholder_id: string | null
          revoked_at: string | null
          role: Database['public']['Enums']['group_role']
          uses: number
        }
        ComputedFields: never
        Insert: {
          code?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          group_id: string
          id?: string
          max_uses?: number | null
          placeholder_id?: string | null
          revoked_at?: string | null
          role?: Database['public']['Enums']['group_role']
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          group_id?: string
          id?: string
          max_uses?: number | null
          placeholder_id?: string | null
          revoked_at?: string | null
          role?: Database['public']['Enums']['group_role']
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: 'group_invites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_invites_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_invites_placeholder_id_fkey'
            columns: ['placeholder_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          role: Database['public']['Enums']['group_role']
          user_id: string
        }
        ComputedFields: never
        Insert: {
          group_id: string
          joined_at?: string
          role?: Database['public']['Enums']['group_role']
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          role?: Database['public']['Enums']['group_role']
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_members_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      group_whiteboards: {
        Row: {
          body: string
          group_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        ComputedFields: never
        Insert: {
          body?: string
          group_id: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          body?: string
          group_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'group_whiteboards_group_id_fkey'
            columns: ['group_id']
            isOneToOne: true
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_whiteboards_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      groups: {
        Row: {
          archived_at: string | null
          color: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          default_split: Json | null
          deleted_at: string | null
          deleted_by: string | null
          emoji: string | null
          ends_on: string | null
          id: string
          is_direct: boolean
          members_can_invite: boolean
          name: string
          simplify_debts: boolean
          starts_on: string | null
          type: Database['public']['Enums']['group_type']
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          archived_at?: string | null
          color?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          default_split?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          emoji?: string | null
          ends_on?: string | null
          id?: string
          is_direct?: boolean
          members_can_invite?: boolean
          name: string
          simplify_debts?: boolean
          starts_on?: string | null
          type?: Database['public']['Enums']['group_type']
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          default_split?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          emoji?: string | null
          ends_on?: string | null
          id?: string
          is_direct?: boolean
          members_can_invite?: boolean
          name?: string
          simplify_debts?: boolean
          starts_on?: string | null
          type?: Database['public']['Enums']['group_type']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'groups_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'groups_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      notification_prefs: {
        Row: {
          category: string
          email: boolean | null
          push: boolean | null
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          category: string
          email?: boolean | null
          push?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          email?: boolean | null
          push?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notification_prefs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          channels: string[]
          created_at: string
          data: NonNullable<Json>
          id: string
          read_at: string | null
          type: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          channels?: string[]
          created_at?: string
          data?: NonNullable<Json>
          id?: string
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          channels?: string[]
          created_at?: string
          data?: NonNullable<Json>
          id?: string
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          handle: string
          kind: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          handle: string
          kind: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          handle?: string
          kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payment_methods_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      placeholders: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          email_hint: string | null
          group_id: string
          held_by: string | null
          held_reminder: boolean
          invited_at: string | null
          invites_sent: number
          profile_id: string
          reminded_at: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_hint?: never
          group_id: string
          held_by?: string | null
          held_reminder?: boolean
          invited_at?: string | null
          invites_sent?: number
          profile_id: string
          reminded_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_hint?: never
          group_id?: string
          held_by?: string | null
          held_reminder?: boolean
          invited_at?: string | null
          invites_sent?: number
          profile_id?: string
          reminded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'placeholders_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'placeholders_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'placeholders_held_by_fkey'
            columns: ['held_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'placeholders_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          default_currency: string
          deleted_at: string | null
          display_name: string
          id: string
          is_placeholder: boolean
          locale: string
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          avatar_path?: string | null
          created_at?: string
          default_currency?: string
          deleted_at?: string | null
          display_name: string
          id: string
          is_placeholder?: boolean
          locale?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          default_currency?: string
          deleted_at?: string | null
          display_name?: string
          id?: string
          is_placeholder?: boolean
          locale?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          last_seen_at: string
          platform: Database['public']['Enums']['push_platform']
          subscription: Json | null
          token: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          last_seen_at?: string
          platform: Database['public']['Enums']['push_platform']
          subscription?: Json | null
          token: string
          user_id?: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          platform?: Database['public']['Enums']['push_platform']
          subscription?: Json | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'push_tokens_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      recurring_expenses: {
        Row: {
          active: boolean
          amount_cents: number
          anchor_day: number | null
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          discount_cents: number | null
          group_id: string
          id: string
          items: Json | null
          next_run_on: string
          notes: string | null
          paid_by: string
          payers: Json | null
          recurrence: Database['public']['Enums']['recurrence']
          split_type: Database['public']['Enums']['split_type']
          splits: NonNullable<Json>
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          amount_cents: number
          anchor_day?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          description: string
          discount_cents?: number | null
          group_id: string
          id?: string
          items?: Json | null
          next_run_on: string
          notes?: string | null
          paid_by: string
          payers?: Json | null
          recurrence: Database['public']['Enums']['recurrence']
          split_type?: Database['public']['Enums']['split_type']
          splits?: NonNullable<Json>
          tax_cents?: number | null
          tip_cents?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_cents?: number
          anchor_day?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          discount_cents?: number | null
          group_id?: string
          id?: string
          items?: Json | null
          next_run_on?: string
          notes?: string | null
          paid_by?: string
          payers?: Json | null
          recurrence?: Database['public']['Enums']['recurrence']
          split_type?: Database['public']['Enums']['split_type']
          splits?: NonNullable<Json>
          tax_cents?: number | null
          tip_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'recurring_expenses_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recurring_expenses_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recurring_expenses_paid_by_fkey'
            columns: ['paid_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          group_id: string | null
          id: string
          reason: string
          reporter_id: string
          subject_user_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          group_id?: string | null
          id?: string
          reason: string
          reporter_id?: string
          subject_user_id?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'reports_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reports_reporter_id_fkey'
            columns: ['reporter_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reports_subject_user_id_fkey'
            columns: ['subject_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      settlements: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          currency: string
          deleted_at?: string | null
          from_user: string
          fx_rate?: number
          group_id: string
          id?: string
          note?: string | null
          settled_at?: string
          to_user: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          from_user?: string
          fx_rate?: number
          group_id?: string
          id?: string
          note?: string | null
          settled_at?: string
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: 'settlements_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settlements_from_user_fkey'
            columns: ['from_user']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settlements_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'settlements_to_user_fkey'
            columns: ['to_user']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      expense_ledger: {
        Row: {
          category: string | null
          currency: string | null
          expense_id: string | null
          group_id: string | null
          paid_cents: number | null
          share_cents: number | null
          spent_at: string | null
          total_cents: number | null
          user_id: string | null
        }
        ComputedFields: never
        Relationships: []
      }
      group_balances: {
        Row: {
          group_id: string | null
          net_cents: number | null
          user_id: string | null
        }
        ComputedFields: never
        Relationships: []
      }
    }
    Functions: {
      accept_friend_invite: { Args: { code: string }; Returns: string }
      accept_invite: { Args: { code: string }; Returns: string }
      add_friend: { Args: { user_id: string }; Returns: undefined }
      add_placeholder_member: {
        Args: { display_name: string; email?: string; group_id: string }
        Returns: string
      }
      best_slots: {
        Args: { event_id: string; limit?: number }
        Returns: {
          ends_at: string
          maybe_count: number
          missing: string[]
          score: number
          starts_at: string
          yes_count: number
        }[]
      }
      block_user: { Args: { user_id: string }; Returns: undefined }
      calendar_feed_token: { Args: { rotate?: boolean }; Returns: string }
      cancel_event: {
        Args: { event_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          day_end_minute: number
          day_start_minute: number
          description: string | null
          duration_minutes: number
          emoji: string | null
          ends_at: string | null
          group_id: string
          id: string
          location: string | null
          min_attendees: number
          reminder_sent_at: string | null
          rsvp_deadline: string | null
          slot_minutes: number
          starts_at: string | null
          status: Database['public']['Enums']['event_status']
          timezone: string
          title: string
          updated_at: string
          window_end: string
          window_start: string
        }
        SetofOptions: {
          from: '*'
          to: 'events'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_mfa_recovery_codes: { Args: Record<PropertyKey, never>; Returns: number }
      create_expense: {
        Args: { payload: Json }
        Returns: {
          amount_cents: number
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          discount_cents: number | null
          event_id: string | null
          fx_rate: number
          group_id: string
          id: string
          is_refund: boolean
          notes: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_type: Database['public']['Enums']['split_type']
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_expense_v2: {
        Args: { payload: Json }
        Returns: {
          amount_cents: number
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          discount_cents: number | null
          event_id: string | null
          fx_rate: number
          group_id: string
          id: string
          is_refund: boolean
          notes: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_type: Database['public']['Enums']['split_type']
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_friend_invite: {
        Args: { email: string }
        Returns: {
          code: string
          created_at: string
          created_by: string
          email: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          revoked_at: string | null
          uses: number
        }
        SetofOptions: {
          from: '*'
          to: 'friend_invites'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_group: {
        Args: { color?: string; currency?: string; emoji?: string; name: string }
        Returns: {
          archived_at: string | null
          color: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          default_split: Json | null
          deleted_at: string | null
          deleted_by: string | null
          emoji: string | null
          ends_on: string | null
          id: string
          is_direct: boolean
          members_can_invite: boolean
          name: string
          simplify_debts: boolean
          starts_on: string | null
          type: Database['public']['Enums']['group_type']
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'groups'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_group_v2: {
        Args: {
          color?: string
          currency?: string
          emoji?: string
          ends_on?: string
          name: string
          starts_on?: string
          type?: Database['public']['Enums']['group_type']
        }
        Returns: {
          archived_at: string | null
          color: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          default_split: Json | null
          deleted_at: string | null
          deleted_by: string | null
          emoji: string | null
          ends_on: string | null
          id: string
          is_direct: boolean
          members_can_invite: boolean
          name: string
          simplify_debts: boolean
          starts_on: string | null
          type: Database['public']['Enums']['group_type']
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'groups'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_guest_link: {
        Args: { event_id: string; max_guests?: number; ttl: string }
        Returns: {
          code: string
          created_at: string
          created_by: string | null
          event_id: string
          expires_at: string
          group_id: string
          id: string
          max_guests: number
          revoked_at: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'event_guest_links'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invite: {
        Args: {
          email?: string
          expires_at?: string
          group_id: string
          max_uses?: number
          role?: Database['public']['Enums']['group_role']
        }
        Returns: {
          code: string
          created_at: string
          created_by: string | null
          email: string | null
          expires_at: string | null
          group_id: string
          id: string
          max_uses: number | null
          placeholder_id: string | null
          revoked_at: string | null
          role: Database['public']['Enums']['group_role']
          uses: number
        }
        SetofOptions: {
          from: '*'
          to: 'group_invites'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_mfa_recovery_codes: { Args: Record<PropertyKey, never>; Returns: string[] }
      delete_expense: {
        Args: { id: string }
        Returns: {
          amount_cents: number
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          discount_cents: number | null
          event_id: string | null
          fx_rate: number
          group_id: string
          id: string
          is_refund: boolean
          notes: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_type: Database['public']['Enums']['split_type']
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_group: { Args: { group_id: string }; Returns: undefined }
      delete_my_account: { Args: Record<PropertyKey, never>; Returns: undefined }
      delete_settlement: {
        Args: { id: string }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }
        SetofOptions: {
          from: '*'
          to: 'settlements'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      deleted_items: {
        Args: { before_at?: string; before_id?: string; in_group: string; max_rows?: number }
        Returns: {
          amount_cents: number
          category: string
          created_by: string
          currency: string
          day: string
          deleted_at: string
          deleted_by: string
          description: string
          group_id: string
          id: string
          kind: string
          paid_by: string
          payers: string[]
          to_user: string
        }[]
      }
      email_outbox_report: {
        Args: { batch: string; delivered: boolean; error?: string; rejected?: string[] }
        Returns: number
      }
      email_unsubscribe: { Args: { action?: string; token: string }; Returns: Json }
      export_my_data: { Args: Record<PropertyKey, never>; Returns: Json }
      forget_mfa_recovery_codes: { Args: { target: string }; Returns: undefined }
      friend_activity: {
        Args: { before_at?: string; before_id?: string; friend: string; max_rows?: number }
        Returns: {
          actor_id: string
          actor_info: Json
          created_at: string
          data: Json
          group_id: string
          group_info: Json
          id: string
          subject_id: string
          verb: string
        }[]
      }
      friend_balances: {
        Args: Record<PropertyKey, never>
        Returns: {
          archived: boolean
          currency: string
          friend_id: string
          group_id: string
          net_cents: number
        }[]
      }
      friend_invite_preview: {
        Args: { code: string }
        Returns: {
          avatar_path: string
          is_friend: boolean
          is_self: boolean
          name: string
          status: string
        }[]
      }
      get_or_create_direct_group: { Args: { friend_id: string }; Returns: string }
      guest_link_preview: {
        Args: { code: string; token?: string }
        Returns: {
          day_end_minute: number
          day_start_minute: number
          duration_minutes: number
          emoji: string
          ends_at: string
          expires_at: string
          group_emoji: string
          guest_count: number
          heat: Json
          host_name: string
          max_guests: number
          my_name: string
          my_slots: Json
          respondents: number
          slot_minutes: number
          starts_at: string
          status: string
          timezone: string
          title: string
          window_end: string
          window_start: string
        }[]
      }
      import_expenses: {
        Args: {
          batch_id?: string
          fingerprint?: string
          group_id: string
          rows: Json
          source?: string
        }
        Returns: Json
      }
      import_stage: { Args: { batch_id: string; group_id: string; rows: Json }; Returns: number }
      invite_preview: {
        Args: { code: string }
        Returns: {
          color: string
          cover_path: string
          emoji: string
          first_names: string[]
          group_id: string
          is_member: boolean
          member_count: number
          name: string
          status: string
        }[]
      }
      invite_preview_v2: {
        Args: { code: string }
        Returns: {
          color: string
          cover_path: string
          email_hint: string
          email_matches: boolean
          emoji: string
          first_names: string[]
          group_id: string
          is_member: boolean
          member_count: number
          name: string
          placeholder_name: string
          status: string
        }[]
      }
      leave_group: { Args: { group_id: string }; Returns: undefined }
      make_expense_recurring: {
        Args: { expense_id: string; recurrence: Database['public']['Enums']['recurrence'] }
        Returns: {
          active: boolean
          amount_cents: number
          anchor_day: number | null
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          discount_cents: number | null
          group_id: string
          id: string
          items: Json | null
          next_run_on: string
          notes: string | null
          paid_by: string
          payers: Json | null
          recurrence: Database['public']['Enums']['recurrence']
          split_type: Database['public']['Enums']['split_type']
          splits: NonNullable<Json>
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'recurring_expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mfa_recovery_code_matches: { Args: { code: string; target: string }; Returns: boolean }
      mfa_recovery_codes_left: { Args: Record<PropertyKey, never>; Returns: number }
      my_blocks: {
        Args: Record<PropertyKey, never>
        Returns: {
          avatar_path: string
          blocked_at: string
          display_name: string
          user_id: string
        }[]
      }
      my_deleted_groups: {
        Args: Record<PropertyKey, never>
        Returns: {
          color: string
          cover_path: string
          deleted_at: string
          deleted_by: string
          emoji: string
          id: string
          member_count: number
          name: string
          purge_after: string
          type: Database['public']['Enums']['group_type']
        }[]
      }
      my_friend_link: { Args: { rotate?: boolean }; Returns: string }
      my_notification_prefs: {
        Args: Record<PropertyKey, never>
        Returns: {
          category: string
          email: boolean
          email_allowed: boolean
          push: boolean
          push_allowed: boolean
        }[]
      }
      my_timeline: {
        Args: { from?: string; to?: string }
        Returns: {
          availability_requested: boolean
          availability_submitted: boolean
          emoji: string
          ends_at: string
          event_id: string
          going_count: number
          group_color: string
          group_emoji: string
          group_id: string
          group_name: string
          location: string
          my_rsvp: Database['public']['Enums']['rsvp_status']
          rsvp_deadline: string
          starts_at: string
          status: Database['public']['Enums']['event_status']
          timezone: string
          title: string
          window_end: string
          window_start: string
        }[]
      }
      notify_mfa_recovered: { Args: { target: string }; Returns: undefined }
      orphan_receipts: { Args: { max_count?: number }; Returns: string[] }
      record_mfa_recover_attempt: { Args: { target: string }; Returns: boolean }
      remind_debt: {
        Args: { group_id: string; note?: string; user_id: string }
        Returns: {
          amount_cents: number
          created_at: string
          currency: string
          from_user: string
          group_id: string
          id: string
          note: string | null
          sent_on: string
          to_user: string
        }
        SetofOptions: {
          from: '*'
          to: 'debt_reminders'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remind_placeholder: { Args: { user_id: string }; Returns: undefined }
      remove_friend: { Args: { friend_id: string }; Returns: undefined }
      remove_guest_answer: { Args: { guest_id: string }; Returns: undefined }
      remove_member: { Args: { group_id: string; user_id: string }; Returns: undefined }
      remove_placeholder: { Args: { user_id: string }; Returns: undefined }
      request_availability: { Args: { event_id: string; user_ids?: string[] }; Returns: number }
      restore_expense: {
        Args: { id: string }
        Returns: {
          amount_cents: number
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          discount_cents: number | null
          event_id: string | null
          fx_rate: number
          group_id: string
          id: string
          is_refund: boolean
          notes: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_type: Database['public']['Enums']['split_type']
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_group: {
        Args: { group_id: string }
        Returns: {
          archived_at: string | null
          color: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          default_split: Json | null
          deleted_at: string | null
          deleted_by: string | null
          emoji: string | null
          ends_on: string | null
          id: string
          is_direct: boolean
          members_can_invite: boolean
          name: string
          simplify_debts: boolean
          starts_on: string | null
          type: Database['public']['Enums']['group_type']
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'groups'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_settlement: {
        Args: { id: string }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }
        SetofOptions: {
          from: '*'
          to: 'settlements'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_guest_link: {
        Args: { link_id: string }
        Returns: {
          code: string
          created_at: string
          created_by: string | null
          event_id: string
          expires_at: string
          group_id: string
          id: string
          max_guests: number
          revoked_at: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'event_guest_links'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_group_whiteboard: {
        Args: { base_version: number; body: string; group_id: string }
        Returns: {
          body: string
          group_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: '*'
          to: 'group_whiteboards'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      schedule_event: {
        Args: { event_id: string; starts_at: string }
        Returns: {
          created_at: string
          created_by: string | null
          day_end_minute: number
          day_start_minute: number
          description: string | null
          duration_minutes: number
          emoji: string | null
          ends_at: string | null
          group_id: string
          id: string
          location: string | null
          min_attendees: number
          reminder_sent_at: string | null
          rsvp_deadline: string | null
          slot_minutes: number
          starts_at: string | null
          status: Database['public']['Enums']['event_status']
          timezone: string
          title: string
          updated_at: string
          window_end: string
          window_start: string
        }
        SetofOptions: {
          from: '*'
          to: 'events'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_money: {
        Args: {
          before_at?: string
          before_day?: string
          before_id?: string
          categories?: string[]
          from_day?: string
          in_group?: string
          kinds?: string[]
          max_rows?: number
          person?: string
          query?: string
          to_day?: string
        }
        Returns: {
          amount_cents: number
          at: string
          category: string
          created_by: string
          currency: string
          day: string
          deleted_at: string
          description: string
          group_amount_cents: number
          group_currency: string
          group_id: string
          id: string
          is_refund: boolean
          kind: string
          matched: string
          my_paid_cents: number
          my_share_cents: number
          paid_by: string
          payers: string[]
          snippet: string
          to_user: string
        }[]
      }
      set_availability: { Args: { event_id: string; slots: Json }; Returns: number }
      set_default_split: { Args: { group_id: string; split: Json }; Returns: Json }
      set_expense_attachments: {
        Args: { attachments: Json; id: string }
        Returns: {
          content_type: string
          created_at: string
          expense_id: string
          group_id: string
          path: string
          position: number
          uploaded_by: string | null
        }[]
        SetofOptions: {
          from: '*'
          to: 'expense_attachments'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_guest_availability: {
        Args: { code: string; name: string; slots: Json; token: string }
        Returns: {
          guest_token: string
          saved: number
        }[]
      }
      set_member_role: {
        Args: { group_id: string; role: Database['public']['Enums']['group_role']; user_id: string }
        Returns: undefined
      }
      set_notification_pref: {
        Args: { category: string; email?: boolean; push?: boolean }
        Returns: undefined
      }
      settle_all: {
        Args: { group_id: string; note?: string; settled_on?: string }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'settlements'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      settle_up: {
        Args: {
          amount_cents: number
          currency?: string
          group_id: string
          note?: string
          to_user: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }
        SetofOptions: {
          from: '*'
          to: 'settlements'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_up_v2: {
        Args: {
          amount_cents: number
          currency?: string
          from_user: string
          group_id: string
          note?: string
          settled_on?: string
          to_user: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }
        SetofOptions: {
          from: '*'
          to: 'settlements'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_with_friend: {
        Args: { amounts?: Json; friend_id: string; note?: string; settled_on?: string }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'settlements'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      simplified_debts: {
        Args: { group_id: string }
        Returns: {
          amount_cents: number
          from_user: string
          to_user: string
        }[]
      }
      skip_recurring_expense: {
        Args: { id: string }
        Returns: {
          active: boolean
          amount_cents: number
          anchor_day: number | null
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          discount_cents: number | null
          group_id: string
          id: string
          items: Json | null
          next_run_on: string
          notes: string | null
          paid_by: string
          payers: Json | null
          recurrence: Database['public']['Enums']['recurrence']
          split_type: Database['public']['Enums']['split_type']
          splits: NonNullable<Json>
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'recurring_expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      spending_summary: {
        Args: { from_day?: string; in_currency?: string; in_group?: string; to_day?: string }
        Returns: {
          category: string
          currency: string
          expense_count: number
          group_id: string
          month: string
          paid_cents: number
          payments_made_cents: number
          payments_received_cents: number
          share_cents: number
          spend_cents: number
          unconverted_count: number
        }[]
      }
      transfer_ownership: { Args: { group_id: string; user_id: string }; Returns: undefined }
      update_expense: {
        Args: { id: string; payload: Json }
        Returns: {
          amount_cents: number
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          discount_cents: number | null
          event_id: string | null
          fx_rate: number
          group_id: string
          id: string
          is_refund: boolean
          notes: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_type: Database['public']['Enums']['split_type']
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_expense_v2: {
        Args: { id: string; payload: Json }
        Returns: {
          amount_cents: number
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          discount_cents: number | null
          event_id: string | null
          fx_rate: number
          group_id: string
          id: string
          is_refund: boolean
          notes: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_at: string
          split_type: Database['public']['Enums']['split_type']
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_placeholder: {
        Args: { display_name?: string; email?: string; user_id: string }
        Returns: boolean
      }
      update_recurring_expense: {
        Args: { id: string; payload: Json }
        Returns: {
          active: boolean
          amount_cents: number
          anchor_day: number | null
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          discount_cents: number | null
          group_id: string
          id: string
          items: Json | null
          next_run_on: string
          notes: string | null
          paid_by: string
          payers: Json | null
          recurrence: Database['public']['Enums']['recurrence']
          split_type: Database['public']['Enums']['split_type']
          splits: NonNullable<Json>
          tax_cents: number | null
          tip_cents: number | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'recurring_expenses'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_settlement: {
        Args: { id: string; payload: Json }
        Returns: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          from_user: string
          fx_rate: number
          group_id: string
          id: string
          note: string | null
          settled_at: string
          to_user: string
        }
        SetofOptions: {
          from: '*'
          to: 'settlements'
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      availability_level: 'yes' | 'maybe'
      event_status: 'polling' | 'scheduled' | 'cancelled' | 'done'
      group_role: 'owner' | 'admin' | 'member'
      group_type: 'home' | 'trip' | 'couple' | 'other'
      push_platform: 'web' | 'ios' | 'android'
      recurrence: 'weekly' | 'biweekly' | 'monthly' | 'yearly'
      rsvp_status: 'going' | 'maybe' | 'declined'
      split_type: 'equal' | 'exact' | 'percent' | 'shares' | 'adjustment' | 'itemized'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      availability_level: ['yes', 'maybe'],
      event_status: ['polling', 'scheduled', 'cancelled', 'done'],
      group_role: ['owner', 'admin', 'member'],
      group_type: ['home', 'trip', 'couple', 'other'],
      push_platform: ['web', 'ios', 'android'],
      recurrence: ['weekly', 'biweekly', 'monthly', 'yearly'],
      rsvp_status: ['going', 'maybe', 'declined'],
      split_type: ['equal', 'exact', 'percent', 'shares', 'adjustment', 'itemized'],
    },
  },
} as const
