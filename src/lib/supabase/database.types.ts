
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "addresses": {
                  Row: {
                    "address_line": string,"city": string,"created_at": string,"customer_id": string,"id": string,"instructions": string | null,"last_used_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line": string,"city": string,"created_at"?: string,"customer_id": string,"id"?: string,"instructions"?: string | null,"last_used_at"?: string
                  }
                  Update: {
                    "address_line"?: string,"city"?: string,"created_at"?: string,"customer_id"?: string,"id"?: string,"instructions"?: string | null,"last_used_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "addresses_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
                  ]
                },"admin_permissions": {
                  Row: {
                    "description": string,"key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"key": string
                  }
                  Update: {
                    "description"?: string,"key"?: string
                  }
                  Relationships: [
                    
                  ]
                },"admin_roles": {
                  Row: {
                    "created_at": string,"description": string | null,"id": number,"is_builtin": boolean,"key": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: never,"is_builtin"?: boolean,"key": string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: never,"is_builtin"?: boolean,"key"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"app_installs": {
                  Row: {
                    "device_id": string,"first_seen": string,"last_seen": string,"opens": number,"platform": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "device_id": string,"first_seen"?: string,"last_seen"?: string,"opens"?: number,"platform": string,"user_id"?: string | null
                  }
                  Update: {
                    "device_id"?: string,"first_seen"?: string,"last_seen"?: string,"opens"?: number,"platform"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": string | null,"after_data": Json | null,"before_data": Json | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": number,"metadata": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: never,"metadata"?: NonNullable<Json>
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: never,"metadata"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"bank_accounts": {
                  Row: {
                    "account_holder": string,"account_number": string,"bank_name": string,"branch": string | null,"created_at": string,"id": string,"instructions_am": string,"instructions_en": string,"is_active": boolean,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_holder": string,"account_number": string,"bank_name": string,"branch"?: string | null,"created_at"?: string,"id"?: string,"instructions_am"?: string,"instructions_en"?: string,"is_active"?: boolean,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "account_holder"?: string,"account_number"?: string,"bank_name"?: string,"branch"?: string | null,"created_at"?: string,"id"?: string,"instructions_am"?: string,"instructions_en"?: string,"is_active"?: boolean,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"blocked_emails": {
                  Row: {
                    "blocked_by": string | null,"created_at": string,"email": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_by"?: string | null,"created_at"?: string,"email": string,"reason": string
                  }
                  Update: {
                    "blocked_by"?: string | null,"created_at"?: string,"email"?: string,"reason"?: string
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"department": Database["public"]['Enums']["department"],"description_am": string | null,"description_en": string | null,"id": string,"image_path": string | null,"is_active": boolean,"name_am": string,"name_en": string,"parent_id": string | null,"slug": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"department": Database["public"]['Enums']["department"],"description_am"?: string | null,"description_en"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name_am": string,"name_en": string,"parent_id"?: string | null,"slug": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"department"?: Database["public"]['Enums']["department"],"description_am"?: string | null,"description_en"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"name_am"?: string,"name_en"?: string,"parent_id"?: string | null,"slug"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_earnings": {
                  Row: {
                    "amount_etb": number,"courier_id": string,"earned_at": string,"id": number,"order_id": string,"order_number": string,"payout_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_etb": number,"courier_id": string,"earned_at"?: string,"id"?: never,"order_id": string,"order_number": string,"payout_id"?: string | null
                  }
                  Update: {
                    "amount_etb"?: number,"courier_id"?: string,"earned_at"?: string,"id"?: never,"order_id"?: string,"order_number"?: string,"payout_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_earnings_courier_id_fkey"
      columns: ["courier_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_earnings_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_earnings_payout_id_fkey"
      columns: ["payout_id"]
isOneToOne: false
      referencedRelation: "courier_payouts"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_notifications": {
                  Row: {
                    "body": string | null,"courier_id": string,"created_at": string,"id": number,"kind": string,"order_id": string | null,"read_at": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"courier_id": string,"created_at"?: string,"id"?: never,"kind": string,"order_id"?: string | null,"read_at"?: string | null,"title": string
                  }
                  Update: {
                    "body"?: string | null,"courier_id"?: string,"created_at"?: string,"id"?: never,"kind"?: string,"order_id"?: string | null,"read_at"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_notifications_courier_id_fkey"
      columns: ["courier_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "courier_notifications_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_payouts": {
                  Row: {
                    "amount_etb": number,"courier_id": string,"deliveries": number,"id": string,"note": string | null,"paid_at": string,"paid_by": string | null,"reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_etb": number,"courier_id": string,"deliveries": number,"id"?: string,"note"?: string | null,"paid_at"?: string,"paid_by"?: string | null,"reference"?: string | null
                  }
                  Update: {
                    "amount_etb"?: number,"courier_id"?: string,"deliveries"?: number,"id"?: string,"note"?: string | null,"paid_at"?: string,"paid_by"?: string | null,"reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_payouts_courier_id_fkey"
      columns: ["courier_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"courier_profiles": {
                  Row: {
                    "available_zone_ids": (string)[],"created_at": string,"fee_override_etb": number | null,"insurance_company": string | null,"insurance_expiry": string | null,"insurance_policy": string | null,"licence_expiry": string | null,"licence_number": string | null,"on_duty": boolean,"on_duty_since": string | null,"phone": string | null,"plate_number": string | null,"profile_id": string,"updated_at": string,"vehicle": string | null,"vehicle_make": string | null,"vehicle_model": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "available_zone_ids"?: (string)[],"created_at"?: string,"fee_override_etb"?: number | null,"insurance_company"?: string | null,"insurance_expiry"?: string | null,"insurance_policy"?: string | null,"licence_expiry"?: string | null,"licence_number"?: string | null,"on_duty"?: boolean,"on_duty_since"?: string | null,"phone"?: string | null,"plate_number"?: string | null,"profile_id": string,"updated_at"?: string,"vehicle"?: string | null,"vehicle_make"?: string | null,"vehicle_model"?: string | null
                  }
                  Update: {
                    "available_zone_ids"?: (string)[],"created_at"?: string,"fee_override_etb"?: number | null,"insurance_company"?: string | null,"insurance_expiry"?: string | null,"insurance_policy"?: string | null,"licence_expiry"?: string | null,"licence_number"?: string | null,"on_duty"?: boolean,"on_duty_since"?: string | null,"phone"?: string | null,"plate_number"?: string | null,"profile_id"?: string,"updated_at"?: string,"vehicle"?: string | null,"vehicle_make"?: string | null,"vehicle_model"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "courier_profiles_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cron_runs": {
                  Row: {
                    "detail": NonNullable<Json>,"last_ok": boolean,"last_run_at": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "detail"?: NonNullable<Json>,"last_ok": boolean,"last_run_at": string,"name": string
                  }
                  Update: {
                    "detail"?: NonNullable<Json>,"last_ok"?: boolean,"last_run_at"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"customer_accounts": {
                  Row: {
                    "accepted_terms_at": string | null,"approval_status": string,"approved_at": string | null,"approved_by": string | null,"created_at": string,"date_of_birth": string | null,"deactivated_at": string | null,"deactivated_by": string | null,"deactivation_reason": string | null,"default_address": string | null,"default_zone_id": string | null,"full_name": string | null,"id": string,"member_id": string,"phone": string | null,"sex": string | null,"updated_at": string,"wallet_balance_etb": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_terms_at"?: string | null,"approval_status"?: string,"approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"date_of_birth"?: string | null,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_reason"?: string | null,"default_address"?: string | null,"default_zone_id"?: string | null,"full_name"?: string | null,"id": string,"member_id": string,"phone"?: string | null,"sex"?: string | null,"updated_at"?: string,"wallet_balance_etb"?: number
                  }
                  Update: {
                    "accepted_terms_at"?: string | null,"approval_status"?: string,"approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"date_of_birth"?: string | null,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_reason"?: string | null,"default_address"?: string | null,"default_zone_id"?: string | null,"full_name"?: string | null,"id"?: string,"member_id"?: string,"phone"?: string | null,"sex"?: string | null,"updated_at"?: string,"wallet_balance_etb"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_accounts_default_zone_id_fkey"
      columns: ["default_zone_id"]
isOneToOne: false
      referencedRelation: "delivery_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"customer_carts": {
                  Row: {
                    "item_count": number,"items": NonNullable<Json>,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "item_count"?: number,"items"?: NonNullable<Json>,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "item_count"?: number,"items"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"customers": {
                  Row: {
                    "created_at": string,"email": string | null,"full_name": string,"id": string,"last_order_at": string | null,"order_count": number,"phone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"full_name": string,"id"?: string,"last_order_at"?: string | null,"order_count"?: number,"phone": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"last_order_at"?: string | null,"order_count"?: number,"phone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"delivery_zones": {
                  Row: {
                    "created_at": string,"estimated_days": string | null,"fee_etb": number,"id": string,"is_active": boolean,"name_am": string,"name_en": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"estimated_days"?: string | null,"fee_etb": number,"id"?: string,"is_active"?: boolean,"name_am": string,"name_en": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"estimated_days"?: string | null,"fee_etb"?: number,"id"?: string,"is_active"?: boolean,"name_am"?: string,"name_en"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"homepage_banners": {
                  Row: {
                    "created_at": string,"ends_at": string | null,"id": string,"image_path": string,"is_active": boolean,"link_href": string | null,"sort_order": number,"starts_at": string | null,"subtitle_am": string,"subtitle_en": string,"title_am": string,"title_en": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at"?: string | null,"id"?: string,"image_path": string,"is_active"?: boolean,"link_href"?: string | null,"sort_order"?: number,"starts_at"?: string | null,"subtitle_am"?: string,"subtitle_en"?: string,"title_am": string,"title_en": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string | null,"id"?: string,"image_path"?: string,"is_active"?: boolean,"link_href"?: string | null,"sort_order"?: number,"starts_at"?: string | null,"subtitle_am"?: string,"subtitle_en"?: string,"title_am"?: string,"title_en"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"inventory_movements": {
                  Row: {
                    "actor_id": string | null,"change": number,"created_at": string,"id": number,"note": string | null,"order_id": string | null,"product_id": string,"quantity_after": number,"reason": Database["public"]['Enums']["inventory_reason"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"change": number,"created_at"?: string,"id"?: never,"note"?: string | null,"order_id"?: string | null,"product_id": string,"quantity_after": number,"reason": Database["public"]['Enums']["inventory_reason"]
                  }
                  Update: {
                    "actor_id"?: string | null,"change"?: number,"created_at"?: string,"id"?: never,"note"?: string | null,"order_id"?: string | null,"product_id"?: string,"quantity_after"?: number,"reason"?: Database["public"]['Enums']["inventory_reason"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_order_fk"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"kpi_targets": {
                  Row: {
                    "id": string,"metric": string,"period": string,"profile_id": string | null,"target": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"metric": string,"period": string,"profile_id"?: string | null,"target": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "id"?: string,"metric"?: string,"period"?: string,"profile_id"?: string | null,"target"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "kpi_targets_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications_outbox": {
                  Row: {
                    "attachment_bucket": string | null,"attachment_path": string | null,"attempts": number,"channel": string,"created_at": string,"dedupe_key": string,"event_type": string,"id": number,"last_error": string | null,"locked_until": string | null,"max_attempts": number,"next_attempt_at": string,"payload": NonNullable<Json>,"recipient_user_id": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["notification_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "attachment_bucket"?: string | null,"attachment_path"?: string | null,"attempts"?: number,"channel"?: string,"created_at"?: string,"dedupe_key": string,"event_type": string,"id"?: never,"last_error"?: string | null,"locked_until"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"payload": NonNullable<Json>,"recipient_user_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"]
                  }
                  Update: {
                    "attachment_bucket"?: string | null,"attachment_path"?: string | null,"attempts"?: number,"channel"?: string,"created_at"?: string,"dedupe_key"?: string,"event_type"?: string,"id"?: never,"last_error"?: string | null,"locked_until"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"payload"?: NonNullable<Json>,"recipient_user_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"]
                  }
                  Relationships: [
                    
                  ]
                },"order_items": {
                  Row: {
                    "created_at": string,"id": string,"item_type": Database["public"]['Enums']["order_item_type"],"line_total_etb": number,"name_am": string,"name_en": string,"order_id": string,"printing_job_id": string | null,"product_id": string | null,"quantity": number,"sku": string | null,"unit_price_etb": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"item_type": Database["public"]['Enums']["order_item_type"],"line_total_etb": number,"name_am": string,"name_en": string,"order_id": string,"printing_job_id"?: string | null,"product_id"?: string | null,"quantity": number,"sku"?: string | null,"unit_price_etb": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"item_type"?: Database["public"]['Enums']["order_item_type"],"line_total_etb"?: number,"name_am"?: string,"name_en"?: string,"order_id"?: string,"printing_job_id"?: string | null,"product_id"?: string | null,"quantity"?: number,"sku"?: string | null,"unit_price_etb"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_printing_job_id_fkey"
      columns: ["printing_job_id"]
isOneToOne: false
      referencedRelation: "printing_jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"order_notes": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string,"body": string,"created_at"?: string,"id"?: string,"order_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_notes_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"order_status_history": {
                  Row: {
                    "changed_by": string | null,"created_at": string,"from_payment_status": Database["public"]['Enums']["payment_status"] | null,"from_status": Database["public"]['Enums']["order_status"] | null,"id": number,"note": string | null,"order_id": string,"to_payment_status": Database["public"]['Enums']["payment_status"],"to_status": Database["public"]['Enums']["order_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_by"?: string | null,"created_at"?: string,"from_payment_status"?: Database["public"]['Enums']["payment_status"] | null,"from_status"?: Database["public"]['Enums']["order_status"] | null,"id"?: never,"note"?: string | null,"order_id": string,"to_payment_status": Database["public"]['Enums']["payment_status"],"to_status": Database["public"]['Enums']["order_status"]
                  }
                  Update: {
                    "changed_by"?: string | null,"created_at"?: string,"from_payment_status"?: Database["public"]['Enums']["payment_status"] | null,"from_status"?: Database["public"]['Enums']["order_status"] | null,"id"?: never,"note"?: string | null,"order_id"?: string,"to_payment_status"?: Database["public"]['Enums']["payment_status"],"to_status"?: Database["public"]['Enums']["order_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_status_history_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "access_token_hash": string,"address_line": string | null,"assigned_to": string | null,"at_shop_at": string | null,"bank_account_id": string | null,"bank_snapshot": NonNullable<Json>,"cancelled_at": string | null,"channel": string,"city": string | null,"courier_assigned_at": string | null,"courier_id": string | null,"created_at": string,"currency": string,"customer_id": string,"customer_name": string,"customer_phone": string,"delivered_at": string | null,"delivery_attempts": number,"delivery_code": string | null,"delivery_code_tries": number,"delivery_fail_reason": string | null,"delivery_failed_at": string | null,"delivery_fee_etb": number,"delivery_fee_full_etb": number | null,"delivery_instructions": string | null,"delivery_zone_id": string | null,"discount_etb": number,"fulfillment_method": Database["public"]['Enums']["fulfillment_method"],"handoff_courier_at": string | null,"handoff_courier_code": string | null,"handoff_shop_at": string | null,"handoff_shop_code": string | null,"handoff_tries": number,"id": string,"idempotency_key": string,"locale": string,"order_number": string,"partner_shop_id": string | null,"partner_snapshot": Json | null,"payment_due_at": string,"payment_method": string,"payment_status": Database["public"]['Enums']["payment_status"],"payment_verified_at": string | null,"payment_verified_by": string | null,"picked_up_at": string | null,"promotion_id": string | null,"status": Database["public"]['Enums']["order_status"],"subtotal_etb": number,"total_etb": number,"tracking_code_hash": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token_hash": string,"address_line"?: string | null,"assigned_to"?: string | null,"at_shop_at"?: string | null,"bank_account_id"?: string | null,"bank_snapshot": NonNullable<Json>,"cancelled_at"?: string | null,"channel"?: string,"city"?: string | null,"courier_assigned_at"?: string | null,"courier_id"?: string | null,"created_at"?: string,"currency"?: string,"customer_id": string,"customer_name": string,"customer_phone": string,"delivered_at"?: string | null,"delivery_attempts"?: number,"delivery_code"?: string | null,"delivery_code_tries"?: number,"delivery_fail_reason"?: string | null,"delivery_failed_at"?: string | null,"delivery_fee_etb"?: number,"delivery_fee_full_etb"?: number | null,"delivery_instructions"?: string | null,"delivery_zone_id"?: string | null,"discount_etb"?: number,"fulfillment_method": Database["public"]['Enums']["fulfillment_method"],"handoff_courier_at"?: string | null,"handoff_courier_code"?: string | null,"handoff_shop_at"?: string | null,"handoff_shop_code"?: string | null,"handoff_tries"?: number,"id"?: string,"idempotency_key": string,"locale"?: string,"order_number"?: string,"partner_shop_id"?: string | null,"partner_snapshot"?: Json | null,"payment_due_at": string,"payment_method"?: string,"payment_status"?: Database["public"]['Enums']["payment_status"],"payment_verified_at"?: string | null,"payment_verified_by"?: string | null,"picked_up_at"?: string | null,"promotion_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"subtotal_etb": number,"total_etb": number,"tracking_code_hash": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "access_token_hash"?: string,"address_line"?: string | null,"assigned_to"?: string | null,"at_shop_at"?: string | null,"bank_account_id"?: string | null,"bank_snapshot"?: NonNullable<Json>,"cancelled_at"?: string | null,"channel"?: string,"city"?: string | null,"courier_assigned_at"?: string | null,"courier_id"?: string | null,"created_at"?: string,"currency"?: string,"customer_id"?: string,"customer_name"?: string,"customer_phone"?: string,"delivered_at"?: string | null,"delivery_attempts"?: number,"delivery_code"?: string | null,"delivery_code_tries"?: number,"delivery_fail_reason"?: string | null,"delivery_failed_at"?: string | null,"delivery_fee_etb"?: number,"delivery_fee_full_etb"?: number | null,"delivery_instructions"?: string | null,"delivery_zone_id"?: string | null,"discount_etb"?: number,"fulfillment_method"?: Database["public"]['Enums']["fulfillment_method"],"handoff_courier_at"?: string | null,"handoff_courier_code"?: string | null,"handoff_shop_at"?: string | null,"handoff_shop_code"?: string | null,"handoff_tries"?: number,"id"?: string,"idempotency_key"?: string,"locale"?: string,"order_number"?: string,"partner_shop_id"?: string | null,"partner_snapshot"?: Json | null,"payment_due_at"?: string,"payment_method"?: string,"payment_status"?: Database["public"]['Enums']["payment_status"],"payment_verified_at"?: string | null,"payment_verified_by"?: string | null,"picked_up_at"?: string | null,"promotion_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"subtotal_etb"?: number,"total_etb"?: number,"tracking_code_hash"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_bank_account_id_fkey"
      columns: ["bank_account_id"]
isOneToOne: false
      referencedRelation: "bank_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_courier_id_fkey"
      columns: ["courier_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_delivery_zone_id_fkey"
      columns: ["delivery_zone_id"]
isOneToOne: false
      referencedRelation: "delivery_zones"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_partner_shop_id_fkey"
      columns: ["partner_shop_id"]
isOneToOne: false
      referencedRelation: "partner_shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id"]
    }
                  ]
                },"partner_earnings": {
                  Row: {
                    "amount_etb": number,"earned_at": string,"id": number,"order_id": string,"order_number": string,"payout_id": string | null,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_etb": number,"earned_at"?: string,"id"?: never,"order_id": string,"order_number": string,"payout_id"?: string | null,"shop_id": string
                  }
                  Update: {
                    "amount_etb"?: number,"earned_at"?: string,"id"?: never,"order_id"?: string,"order_number"?: string,"payout_id"?: string | null,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_earnings_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_earnings_payout_id_fkey"
      columns: ["payout_id"]
isOneToOne: false
      referencedRelation: "partner_payouts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_earnings_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "partner_shops"
      referencedColumns: ["id"]
    }
                  ]
                },"partner_payouts": {
                  Row: {
                    "amount_etb": number,"id": string,"note": string | null,"orders": number,"paid_at": string,"paid_by": string | null,"reference": string | null,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_etb": number,"id"?: string,"note"?: string | null,"orders": number,"paid_at"?: string,"paid_by"?: string | null,"reference"?: string | null,"shop_id": string
                  }
                  Update: {
                    "amount_etb"?: number,"id"?: string,"note"?: string | null,"orders"?: number,"paid_at"?: string,"paid_by"?: string | null,"reference"?: string | null,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_payouts_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "partner_shops"
      referencedColumns: ["id"]
    }
                  ]
                },"partner_shops": {
                  Row: {
                    "address_line": string,"created_at": string,"handling_fee_etb": number,"id": string,"is_active": boolean,"landmark": string | null,"map_url": string | null,"name": string,"opening_hours": string | null,"phone": string,"updated_at": string,"zone_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line": string,"created_at"?: string,"handling_fee_etb"?: number,"id"?: string,"is_active"?: boolean,"landmark"?: string | null,"map_url"?: string | null,"name": string,"opening_hours"?: string | null,"phone": string,"updated_at"?: string,"zone_id": string
                  }
                  Update: {
                    "address_line"?: string,"created_at"?: string,"handling_fee_etb"?: number,"id"?: string,"is_active"?: boolean,"landmark"?: string | null,"map_url"?: string | null,"name"?: string,"opening_hours"?: string | null,"phone"?: string,"updated_at"?: string,"zone_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_shops_zone_id_fkey"
      columns: ["zone_id"]
isOneToOne: false
      referencedRelation: "delivery_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"partner_staff": {
                  Row: {
                    "created_at": string,"profile_id": string,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"profile_id": string,"shop_id": string
                  }
                  Update: {
                    "created_at"?: string,"profile_id"?: string,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_staff_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_staff_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "partner_shops"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_submissions": {
                  Row: {
                    "amount_expected_etb": number,"id": string,"order_id": string,"receipt_mime": string,"receipt_original_name": string | null,"receipt_path": string,"receipt_sha256": string,"receipt_size_bytes": number,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": Database["public"]['Enums']["submission_status"],"submitted_at": string,"transaction_reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_expected_etb": number,"id"?: string,"order_id": string,"receipt_mime": string,"receipt_original_name"?: string | null,"receipt_path": string,"receipt_sha256": string,"receipt_size_bytes": number,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["submission_status"],"submitted_at"?: string,"transaction_reference"?: string | null
                  }
                  Update: {
                    "amount_expected_etb"?: number,"id"?: string,"order_id"?: string,"receipt_mime"?: string,"receipt_original_name"?: string | null,"receipt_path"?: string,"receipt_sha256"?: string,"receipt_size_bytes"?: number,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["submission_status"],"submitted_at"?: string,"transaction_reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_submissions_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"printing_files": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"job_id": string,"mime_type": string,"original_name": string,"page_count": number | null,"sha256": string,"size_bytes": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"job_id": string,"mime_type": string,"original_name": string,"page_count"?: number | null,"sha256": string,"size_bytes": number,"storage_path": string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"job_id"?: string,"mime_type"?: string,"original_name"?: string,"page_count"?: number | null,"sha256"?: string,"size_bytes"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "printing_files_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "printing_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"printing_job_history": {
                  Row: {
                    "changed_by": string | null,"created_at": string,"from_status": Database["public"]['Enums']["print_job_status"] | null,"id": number,"job_id": string,"note": string | null,"to_status": Database["public"]['Enums']["print_job_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_by"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["print_job_status"] | null,"id"?: never,"job_id": string,"note"?: string | null,"to_status": Database["public"]['Enums']["print_job_status"]
                  }
                  Update: {
                    "changed_by"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["print_job_status"] | null,"id"?: never,"job_id"?: string,"note"?: string | null,"to_status"?: Database["public"]['Enums']["print_job_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "printing_job_history_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "printing_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"printing_jobs": {
                  Row: {
                    "access_token_hash": string,"assigned_to": string | null,"color_mode": Database["public"]['Enums']["print_color_mode"],"copies": number,"created_at": string,"customer_id": string | null,"customer_name": string,"customer_notes": string | null,"customer_phone": string,"estimated_total_etb": number | null,"files_delete_after": string,"files_deleted_at": string | null,"fulfillment_method": Database["public"]['Enums']["fulfillment_method"],"id": string,"job_number": string,"order_id": string | null,"page_count": number | null,"page_count_source": string | null,"paper_size": string,"price_per_page_etb": number | null,"quoted_at": string | null,"quoted_by": string | null,"service_charge_etb": number,"sides": Database["public"]['Enums']["print_sides"],"status": Database["public"]['Enums']["print_job_status"],"total_etb": number | null,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token_hash": string,"assigned_to"?: string | null,"color_mode": Database["public"]['Enums']["print_color_mode"],"copies": number,"created_at"?: string,"customer_id"?: string | null,"customer_name": string,"customer_notes"?: string | null,"customer_phone": string,"estimated_total_etb"?: number | null,"files_delete_after"?: string,"files_deleted_at"?: string | null,"fulfillment_method"?: Database["public"]['Enums']["fulfillment_method"],"id"?: string,"job_number"?: string,"order_id"?: string | null,"page_count"?: number | null,"page_count_source"?: string | null,"paper_size": string,"price_per_page_etb"?: number | null,"quoted_at"?: string | null,"quoted_by"?: string | null,"service_charge_etb"?: number,"sides": Database["public"]['Enums']["print_sides"],"status"?: Database["public"]['Enums']["print_job_status"],"total_etb"?: number | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "access_token_hash"?: string,"assigned_to"?: string | null,"color_mode"?: Database["public"]['Enums']["print_color_mode"],"copies"?: number,"created_at"?: string,"customer_id"?: string | null,"customer_name"?: string,"customer_notes"?: string | null,"customer_phone"?: string,"estimated_total_etb"?: number | null,"files_delete_after"?: string,"files_deleted_at"?: string | null,"fulfillment_method"?: Database["public"]['Enums']["fulfillment_method"],"id"?: string,"job_number"?: string,"order_id"?: string | null,"page_count"?: number | null,"page_count_source"?: string | null,"paper_size"?: string,"price_per_page_etb"?: number | null,"quoted_at"?: string | null,"quoted_by"?: string | null,"service_charge_etb"?: number,"sides"?: Database["public"]['Enums']["print_sides"],"status"?: Database["public"]['Enums']["print_job_status"],"total_etb"?: number | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "printing_jobs_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "printing_jobs_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "printing_jobs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"printing_price_rules": {
                  Row: {
                    "color_mode": Database["public"]['Enums']["print_color_mode"],"created_at": string,"id": string,"is_active": boolean,"paper_size": string,"price_per_page_etb": number,"sides": Database["public"]['Enums']["print_sides"],"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color_mode": Database["public"]['Enums']["print_color_mode"],"created_at"?: string,"id"?: string,"is_active"?: boolean,"paper_size": string,"price_per_page_etb": number,"sides": Database["public"]['Enums']["print_sides"],"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "color_mode"?: Database["public"]['Enums']["print_color_mode"],"created_at"?: string,"id"?: string,"is_active"?: boolean,"paper_size"?: string,"price_per_page_etb"?: number,"sides"?: Database["public"]['Enums']["print_sides"],"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"product_images": {
                  Row: {
                    "alt_am": string | null,"alt_en": string | null,"created_at": string,"id": string,"is_primary": boolean,"product_id": string,"sort_order": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alt_am"?: string | null,"alt_en"?: string | null,"created_at"?: string,"id"?: string,"is_primary"?: boolean,"product_id": string,"sort_order"?: number,"storage_path": string
                  }
                  Update: {
                    "alt_am"?: string | null,"alt_en"?: string | null,"created_at"?: string,"id"?: string,"is_primary"?: boolean,"product_id"?: string,"sort_order"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_images_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_reviews": {
                  Row: {
                    "body": string | null,"created_at": string,"display_name": string,"id": string,"order_id": string | null,"product_id": string,"rating": number,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"display_name": string,"id"?: string,"order_id"?: string | null,"product_id": string,"rating": number,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"order_id"?: string | null,"product_id"?: string,"rating"?: number,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_reviews_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_reviews_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "archived_at": string | null,"audience": string | null,"brand": string | null,"category_id": string,"created_at": string,"created_by": string | null,"description_am": string,"description_en": string,"effective_price_etb": number | null,"id": string,"is_featured": boolean,"low_stock_threshold": number,"name_am": string,"name_en": string,"price_etb": number,"rating_avg": number | null,"rating_count": number,"sale_price_etb": number | null,"sku": string,"slug": string,"status": Database["public"]['Enums']["product_status"],"stock_quantity": number,"track_inventory": boolean,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"audience"?: string | null,"brand"?: string | null,"category_id": string,"created_at"?: string,"created_by"?: string | null,"description_am"?: string,"description_en"?: string,"effective_price_etb"?: never,"id"?: string,"is_featured"?: boolean,"low_stock_threshold"?: number,"name_am": string,"name_en": string,"price_etb": number,"rating_avg"?: number | null,"rating_count"?: number,"sale_price_etb"?: number | null,"sku": string,"slug": string,"status"?: Database["public"]['Enums']["product_status"],"stock_quantity"?: number,"track_inventory"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"audience"?: string | null,"brand"?: string | null,"category_id"?: string,"created_at"?: string,"created_by"?: string | null,"description_am"?: string,"description_en"?: string,"effective_price_etb"?: never,"id"?: string,"is_featured"?: boolean,"low_stock_threshold"?: number,"name_am"?: string,"name_en"?: string,"price_etb"?: number,"rating_avg"?: number | null,"rating_count"?: number,"sale_price_etb"?: number | null,"sku"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["product_status"],"stock_quantity"?: number,"track_inventory"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"profile_permissions": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"permission_key": string,"profile_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"permission_key": string,"profile_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"permission_key"?: string,"profile_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_permissions_permission_key_fkey"
      columns: ["permission_key"]
isOneToOne: false
      referencedRelation: "admin_permissions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "profile_permissions_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"created_by": string | null,"date_of_birth": string | null,"full_name": string,"id": string,"is_active": boolean,"phone": string | null,"removed_at": string | null,"removed_by": string | null,"role_id": number,"sex": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"date_of_birth"?: string | null,"full_name": string,"id": string,"is_active"?: boolean,"phone"?: string | null,"removed_at"?: string | null,"removed_by"?: string | null,"role_id": number,"sex"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"date_of_birth"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string | null,"removed_at"?: string | null,"removed_by"?: string | null,"role_id"?: number,"sex"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "admin_roles"
      referencedColumns: ["id"]
    }
                  ]
                },"promotion_customers": {
                  Row: {
                    "created_at": string,"created_by": string | null,"promotion_id": string,"used_at": string | null,"used_order_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"promotion_id": string,"used_at"?: string | null,"used_order_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"promotion_id"?: string,"used_at"?: string | null,"used_order_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_customers_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotion_customers_used_order_id_fkey"
      columns: ["used_order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"promotions": {
                  Row: {
                    "category_id": string | null,"code": string | null,"created_at": string,"description_am": string,"description_en": string,"discount_type": string,"discount_value": number,"ends_at": string | null,"id": string,"is_active": boolean,"max_redemptions": number | null,"min_order_etb": number,"once_per_customer": boolean,"product_id": string | null,"restricted": boolean,"revoked_at": string | null,"revoked_by": string | null,"revoked_reason": string | null,"show_on_homepage": boolean,"starts_at": string | null,"title_am": string,"title_en": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"code"?: string | null,"created_at"?: string,"description_am"?: string,"description_en"?: string,"discount_type": string,"discount_value": number,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"max_redemptions"?: number | null,"min_order_etb"?: number,"once_per_customer"?: boolean,"product_id"?: string | null,"restricted"?: boolean,"revoked_at"?: string | null,"revoked_by"?: string | null,"revoked_reason"?: string | null,"show_on_homepage"?: boolean,"starts_at"?: string | null,"title_am": string,"title_en": string,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"code"?: string | null,"created_at"?: string,"description_am"?: string,"description_en"?: string,"discount_type"?: string,"discount_value"?: number,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"max_redemptions"?: number | null,"min_order_etb"?: number,"once_per_customer"?: boolean,"product_id"?: string | null,"restricted"?: boolean,"revoked_at"?: string | null,"revoked_by"?: string | null,"revoked_reason"?: string | null,"show_on_homepage"?: boolean,"starts_at"?: string | null,"title_am"?: string,"title_en"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotions_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotions_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"last_used_at": string | null,"locale": string,"p256dh": string,"user_agent": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"last_used_at"?: string | null,"locale"?: string,"p256dh": string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"last_used_at"?: string | null,"locale"?: string,"p256dh"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "hits": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "hits"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"role_permissions": {
                  Row: {
                    "permission_key": string,"role_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "permission_key": string,"role_id": number
                  }
                  Update: {
                    "permission_key"?: string,"role_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_permission_key_fkey"
      columns: ["permission_key"]
isOneToOne: false
      referencedRelation: "admin_permissions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "role_permissions_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "admin_roles"
      referencedColumns: ["id"]
    }
                  ]
                },"security_events": {
                  Row: {
                    "created_at": string,"email": string | null,"id": number,"ip_hash": string | null,"kind": string,"metadata": NonNullable<Json>,"user_agent": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"id"?: never,"ip_hash"?: string | null,"kind": string,"metadata"?: NonNullable<Json>,"user_agent"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"id"?: never,"ip_hash"?: string | null,"kind"?: string,"metadata"?: NonNullable<Json>,"user_agent"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"security_reviews": {
                  Row: {
                    "hidden_at": string | null,"note": string | null,"reviewed_at": string,"reviewed_by": string | null,"subject": string,"subject_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hidden_at"?: string | null,"note"?: string | null,"reviewed_at"?: string,"reviewed_by"?: string | null,"subject": string,"subject_type": string
                  }
                  Update: {
                    "hidden_at"?: string | null,"note"?: string | null,"reviewed_at"?: string,"reviewed_by"?: string | null,"subject"?: string,"subject_type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"staff_hr": {
                  Row: {
                    "address": string | null,"city": string | null,"emergency_name": string | null,"emergency_phone": string | null,"fayda_number": string | null,"job_title": string | null,"notes": string | null,"passport_number": string | null,"profile_id": string,"start_date": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"city"?: string | null,"emergency_name"?: string | null,"emergency_phone"?: string | null,"fayda_number"?: string | null,"job_title"?: string | null,"notes"?: string | null,"passport_number"?: string | null,"profile_id": string,"start_date"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"city"?: string | null,"emergency_name"?: string | null,"emergency_phone"?: string | null,"fayda_number"?: string | null,"job_title"?: string | null,"notes"?: string | null,"passport_number"?: string | null,"profile_id"?: string,"start_date"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_hr_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_alerts": {
                  Row: {
                    "created_at": string,"id": string,"notified_at": string | null,"product_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"notified_at"?: string | null,"product_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"notified_at"?: string | null,"product_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_alerts_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"support_ticket_messages": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"from_staff": boolean,"id": number,"internal": boolean,"ticket_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"from_staff"?: boolean,"id"?: never,"internal"?: boolean,"ticket_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"from_staff"?: boolean,"id"?: never,"internal"?: boolean,"ticket_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "support_ticket_messages_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "support_tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"support_tickets": {
                  Row: {
                    "assigned_to": string | null,"category": string,"closed_at": string | null,"created_at": string,"details": string,"id": string,"last_message_at": string,"order_id": string | null,"order_number": string | null,"rated_at": string | null,"rating": number | null,"rating_comment": string | null,"resolved_at": string | null,"status": string,"subject": string,"ticket_number": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"category": string,"closed_at"?: string | null,"created_at"?: string,"details": string,"id"?: string,"last_message_at"?: string,"order_id"?: string | null,"order_number"?: string | null,"rated_at"?: string | null,"rating"?: number | null,"rating_comment"?: string | null,"resolved_at"?: string | null,"status"?: string,"subject": string,"ticket_number"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "assigned_to"?: string | null,"category"?: string,"closed_at"?: string | null,"created_at"?: string,"details"?: string,"id"?: string,"last_message_at"?: string,"order_id"?: string | null,"order_number"?: string | null,"rated_at"?: string | null,"rating"?: number | null,"rating_comment"?: string | null,"resolved_at"?: string | null,"status"?: string,"subject"?: string,"ticket_number"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "support_tickets_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "support_tickets_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"upload_scans": {
                  Row: {
                    "created_at": string,"duration_ms": number | null,"file_type": string,"findings": string | null,"id": number,"member_id": string | null,"ref": string | null,"result": string,"scanner": string,"sha256": string,"size_bytes": number,"source": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"duration_ms"?: number | null,"file_type": string,"findings"?: string | null,"id"?: never,"member_id"?: string | null,"ref"?: string | null,"result": string,"scanner"?: string,"sha256": string,"size_bytes": number,"source": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"duration_ms"?: number | null,"file_type"?: string,"findings"?: string | null,"id"?: never,"member_id"?: string | null,"ref"?: string | null,"result"?: string,"scanner"?: string,"sha256"?: string,"size_bytes"?: number,"source"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"wallet_ledger": {
                  Row: {
                    "amount_etb": number,"balance_after_etb": number,"created_at": string,"created_by": string | null,"id": number,"kind": string,"note": string | null,"order_id": string | null,"topup_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_etb": number,"balance_after_etb": number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"kind": string,"note"?: string | null,"order_id"?: string | null,"topup_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "amount_etb"?: number,"balance_after_etb"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"kind"?: string,"note"?: string | null,"order_id"?: string | null,"topup_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "wallet_ledger_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wallet_ledger_topup_id_fkey"
      columns: ["topup_id"]
isOneToOne: false
      referencedRelation: "wallet_topups"
      referencedColumns: ["id"]
    }
                  ]
                },"wallet_topups": {
                  Row: {
                    "amount_etb": number,"bank_snapshot": Json | null,"created_at": string,"id": string,"receipt_mime": string,"receipt_path": string,"receipt_sha256": string,"receipt_size_bytes": number,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": string,"topup_number": string,"transaction_reference": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_etb": number,"bank_snapshot"?: Json | null,"created_at"?: string,"id"?: string,"receipt_mime": string,"receipt_path": string,"receipt_sha256": string,"receipt_size_bytes": number,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"topup_number"?: string,"transaction_reference"?: string | null,"user_id": string
                  }
                  Update: {
                    "amount_etb"?: number,"bank_snapshot"?: Json | null,"created_at"?: string,"id"?: string,"receipt_mime"?: string,"receipt_path"?: string,"receipt_sha256"?: string,"receipt_size_bytes"?: number,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"topup_number"?: string,"transaction_reference"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"website_settings": {
                  Row: {
                    "is_public": boolean,"key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "is_public"?: boolean,"key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "is_public"?: boolean,"key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_activity_by_category":
{ Args: { "p_before_id"?: number,"p_category"?: string,"p_from"?: string,"p_limit"?: number,"p_search"?: string,"p_to"?: string }; Returns: {
              "action": string,"actor_id": string,"actor_member_id": string,"actor_name": string,"actor_role": string,"after_data": Json,"before_data": Json,"category": string,"created_at": string,"entity_id": string,"entity_label": string,"entity_type": string,"id": number,"metadata": Json,"subject_member_id": string
            }[]
                           },
"admin_activity_categories":
{ Args: { "p_days"?: number }; Returns: {
              "category": string,"last_at": string,"total": number
            }[]
                           },
"admin_activity_export":
{ Args: { "p_entity_type"?: string,"p_from": string,"p_to": string }; Returns: {
              "action": string,"actor_member_id": string,"actor_name": string,"actor_role": string,"after_data": Json,"before_data": Json,"created_at": string,"entity_id": string,"entity_label": string,"entity_type": string,"id": number,"metadata": Json,"subject_member_id": string
            }[]
                           },
"admin_activity_log":
{ Args: { "p_before_id"?: number,"p_entity_type"?: string,"p_limit"?: number,"p_search"?: string }; Returns: {
              "action": string,"actor_id": string,"actor_name": string,"actor_role": string,"after_data": Json,"before_data": Json,"created_at": string,"entity_id": string,"entity_label": string,"entity_type": string,"id": number,"metadata": Json
            }[]
                           },
"admin_adjust_stock":
{ Args: { "p_change": number,"p_note"?: string,"p_product_id": string,"p_reason": Database["public"]['Enums']["inventory_reason"] }; Returns: number
                           },
"admin_adjust_wallet":
{ Args: { "p_amount": number,"p_reason": string,"p_user_id": string }; Returns: Json
                           },
"admin_analytics":
{ Args: { "p_bucket"?: string,"p_from": string,"p_to": string }; Returns: Json
                           },
"admin_app_installs":
{ Args: Record<PropertyKey, never>; Returns: {
              "device_id": string,"email": string,"first_seen": string,"full_name": string,"is_staff": boolean,"last_seen": string,"member_id": string,"opens": number,"platform": string,"user_id": string
            }[]
                           },
"admin_approve_customer":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"admin_archive_past_receipts":
{ Args: { "p_from": string,"p_to": string }; Returns: number
                           },
"admin_assign_courier":
{ Args: { "p_courier": string,"p_order_id": string }; Returns: undefined
                           },
"admin_assign_order":
{ Args: { "p_assignee": string,"p_order_id": string }; Returns: undefined
                           },
"admin_assign_promotion":
{ Args: { "p_emails": (string)[],"p_note"?: string,"p_notify"?: boolean,"p_promotion_id": string }; Returns: Json
                           },
"admin_auto_assign_courier":
{ Args: { "p_order_id": string }; Returns: string
                           },
"admin_block_email":
{ Args: { "p_email": string,"p_reason": string }; Returns: Json
                           },
"admin_blocked_emails":
{ Args: Record<PropertyKey, never>; Returns: {
              "blocked_by": string,"created_at": string,"email": string,"has_account": boolean,"reason": string
            }[]
                           },
"admin_clear_audit_logs":
{ Args: { "p_before": string }; Returns: number
                           },
"admin_clear_audit_range":
{ Args: { "p_from": string,"p_to": string }; Returns: number
                           },
"admin_clear_notifications":
{ Args: { "p_from": string,"p_to": string }; Returns: number
                           },
"admin_clear_reviewed_list":
{ Args: { "p_subject"?: string,"p_type"?: string }; Returns: number
                           },
"admin_clear_tickets":
{ Args: { "p_from": string,"p_to": string }; Returns: number
                           },
"admin_courier_orders":
{ Args: { "p_courier"?: string,"p_from": string,"p_to": string }; Returns: {
              "assigned_at": string,"city": string,"courier_earned_etb": number,"courier_name": string,"courier_user_id": string,"delivered_at": string,"delivery_attempts": number,"delivery_fee_etb": number,"delivery_fee_full_etb": number,"fail_reason": string,"order_number": string,"order_total_etb": number,"paid_out_at": string,"picked_up_at": string,"status": string
            }[]
                           },
"admin_couriers":
{ Args: Record<PropertyKey, never>; Returns: {
              "active_deliveries": number,"cities": string,"declined_month": number,"delivered_month": number,"delivered_total": number,"email": string,"failed_month": number,"full_name": string,"id": string,"insurance_company": string,"insurance_expiry": string,"insurance_policy": string,"is_active": boolean,"last_delivered_at": string,"licence_expiry": string,"licence_number": string,"member_id": string,"on_duty": boolean,"on_duty_since": string,"phone": string,"plate_number": string,"unpaid_etb": number,"vehicle": string,"vehicle_make": string,"vehicle_model": string,"zone_ids": (string)[]
            }[]
                           },
"admin_create_instore_sale":
{ Args: { "p_customer_name"?: string,"p_customer_phone"?: string,"p_discount_etb"?: number,"p_idempotency_key"?: string,"p_items": Json,"p_note"?: string,"p_payment_method": string }; Returns: Json
                           },
"admin_create_personal_code":
{ Args: { "p_days"?: number,"p_discount_type": string,"p_min_order"?: number,"p_note"?: string,"p_notify"?: boolean,"p_user_id": string,"p_value": number }; Returns: Json
                           },
"admin_create_staff_profile":
{ Args: { "p_full_name": string,"p_role_key": string,"p_user_id": string }; Returns: undefined
                           },
"admin_customer_accounts":
{ Args: { "p_limit"?: number,"p_search"?: string,"p_user_id"?: string }; Returns: {
              "created_at": string,"deactivated_at": string,"deactivated_by_name": string,"deactivation_reason": string,"email": string,"email_confirmed_at": string,"full_name": string,"id": string,"is_staff": boolean,"last_order_at": string,"last_sign_in_at": string,"member_id": string,"order_count": number,"phone": string
            }[]
                           },
"admin_customer_activity":
{ Args: { "p_limit"?: number,"p_user_id": string }; Returns: {
              "action": string,"actor_name": string,"at": string,"details": Json,"kind": string,"reference": string
            }[]
                           },
"admin_dashboard_stats":
{ Args: { "p_days"?: number }; Returns: Json
                           },
"admin_data_export":
{ Args: { "p_area": string,"p_limit"?: number,"p_offset"?: number }; Returns: Json[]
                           },
"admin_data_export_areas":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"admin_delete_kpi_target":
{ Args: { "p_id": string }; Returns: undefined
                           },
"admin_delete_promotion":
{ Args: { "p_promotion_id": string }; Returns: undefined
                           },
"admin_delete_role":
{ Args: { "p_role_id": number }; Returns: undefined
                           },
"admin_delivery_monitor":
{ Args: { "p_events"?: number }; Returns: Json
                           },
"admin_dispatch_orders":
{ Args: Record<PropertyKey, never>; Returns: {
              "address_line": string,"city": string,"courier_id": string,"courier_pay_etb": number,"delivery_attempts": number,"delivery_fee_etb": number,"fail_reason": string,"items": number,"order_id": string,"order_number": string,"paid_at": string,"partner_shop": string,"status": string,"total_etb": number,"zone_id": string
            }[]
                           },
"admin_find_user":
{ Args: { "p_member_id": string }; Returns: {
              "is_staff": boolean,"member_id": string,"user_id": string
            }[]
                           },
"admin_is_staff_account":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"admin_last_sign_ins":
{ Args: { "p_before"?: string,"p_from"?: string,"p_search"?: string,"p_to"?: string }; Returns: {
              "created_at": string,"email": string,"full_name": string,"is_staff": boolean,"last_sign_in_at": string,"member_id": string,"role_name": string,"signed_in_now": boolean,"user_id": string
            }[]
                           },
"admin_log_customer_action":
{ Args: { "p_action": string,"p_metadata"?: Json,"p_user_id": string }; Returns: undefined
                           },
"admin_log_export":
{ Args: { "p_kind": string,"p_metadata"?: Json }; Returns: undefined
                           },
"admin_log_mfa_reset":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"admin_low_stock_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"admin_mark_printing_files_deleted":
{ Args: { "p_job_id": string }; Returns: number
                           },
"admin_mark_security_reviewed":
{ Args: { "p_note"?: string,"p_subjects": (string)[],"p_type": string }; Returns: number
                           },
"admin_moderate_review":
{ Args: { "p_decision": string,"p_note"?: string,"p_review_id": string }; Returns: undefined
                           },
"admin_notifications":
{ Args: { "p_limit"?: number }; Returns: {
              "attempts": number,"channel": string,"created_at": string,"event_type": string,"id": number,"last_error": string,"max_attempts": number,"next_attempt_at": string,"reference": string,"sent_at": string,"status": Database["public"]['Enums']["notification_status"]
            }[]
                           },
"admin_notifications_export":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "attempts": number,"channel": string,"created_at": string,"event_type": string,"id": number,"last_error": string,"recipient": string,"reference": string,"sent_at": string,"status": string
            }[]
                           },
"admin_notifications_search":
{ Args: { "p_from"?: string,"p_limit"?: number,"p_search"?: string,"p_to"?: string }; Returns: {
              "attempts": number,"channel": string,"created_at": string,"event_type": string,"id": number,"last_error": string,"max_attempts": number,"next_attempt_at": string,"reference": string,"sent_at": string,"status": Database["public"]['Enums']["notification_status"]
            }[]
                           },
"admin_partner_orders":
{ Args: { "p_from": string,"p_shop"?: string,"p_to": string }; Returns: {
              "at_shop_at": string,"city": string,"collected_at": string,"courier_user_id": string,"delivery_fee_etb": number,"delivery_fee_full_etb": number,"order_number": string,"order_total_etb": number,"paid_at": string,"paid_out_at": string,"picked_up_at": string,"shop": string,"shop_earned_etb": number,"status": string
            }[]
                           },
"admin_partner_shops":
{ Args: Record<PropertyKey, never>; Returns: {
              "address_line": string,"at_shop": number,"city": string,"collected_month": number,"handling_fee_etb": number,"id": string,"incoming": number,"is_active": boolean,"landmark": string,"last_collected_at": string,"map_url": string,"name": string,"opening_hours": string,"phone": string,"staff": string,"staff_count": number,"unpaid_etb": number,"zone_id": string
            }[]
                           },
"admin_partner_staff":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"full_name": string,"id": string,"is_active": boolean,"member_id": string,"shop": string,"shop_id": string
            }[]
                           },
"admin_pay_courier":
{ Args: { "p_courier": string,"p_note"?: string,"p_reference"?: string }; Returns: Json
                           },
"admin_pay_partner":
{ Args: { "p_note"?: string,"p_reference"?: string,"p_shop": string }; Returns: Json
                           },
"admin_payments_export":
{ Args: { "p_from": string,"p_status"?: string,"p_to": string }; Returns: {
              "account_number": string,"amount_expected_etb": number,"bank_name": string,"customer_email": string,"customer_name": string,"customer_phone": string,"id": string,"order_number": string,"order_status": string,"order_total_etb": number,"payment_method": string,"receipt_original_name": string,"receipt_sha256": string,"receipt_used_elsewhere": number,"reference_used_elsewhere": number,"review_note": string,"reviewed_at": string,"reviewed_by_name": string,"status": string,"submitted_at": string,"transaction_reference": string
            }[]
                           },
"admin_pending_customers":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"date_of_birth": string,"default_address": string,"email": string,"email_confirmed": boolean,"full_name": string,"id": string,"last_sign_in_at": string,"member_id": string,"phone": string,"sex": string
            }[]
                           },
"admin_prepare_customer_delete":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"admin_product_reviews":
{ Args: { "p_limit"?: number,"p_status"?: string }; Returns: {
              "body": string,"created_at": string,"customer_email": string,"display_name": string,"id": string,"order_id": string,"order_number": string,"product_id": string,"product_name": string,"product_slug": string,"rating": number,"review_note": string,"reviewed_at": string,"reviewed_by_name": string,"status": string,"updated_at": string
            }[]
                           },
"admin_promotion_customers":
{ Args: { "p_promotion_id"?: string,"p_user_id"?: string }; Returns: {
              "assigned_at": string,"code": string,"email": string,"full_name": string,"member_id": string,"promotion_id": string,"reserved": boolean,"revoked": boolean,"title_en": string,"used": boolean,"used_at": string,"used_order_number": string,"user_id": string
            }[]
                           },
"admin_promotion_uses":
{ Args: { "p_from": string,"p_limit"?: number,"p_to": string }; Returns: {
              "audience": string,"code": string,"delivery_fee_etb": number,"discount_etb": number,"discount_rule": string,"items": string,"member_id": string,"order_number": string,"order_status": string,"ordered_at": string,"original_total_etb": number,"paid_at": string,"payment_method": string,"promotion": string,"promotion_status": string,"subtotal_etb": number,"total_etb": number
            }[]
                           },
"admin_queue_group_test":
{ Args: { "p_group": string }; Returns: undefined
                           },
"admin_queue_security_test":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"admin_queue_test_notification":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"admin_quote_printing_job":
{ Args: { "p_job_id": string,"p_note"?: string,"p_page_count": number,"p_total_etb"?: number }; Returns: Json
                           },
"admin_receipt_archive_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_reject_customer":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: Json
                           },
"admin_remove_staff":
{ Args: { "p_user_id": string }; Returns: string
                           },
"admin_reset_phrase":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"admin_reset_test_data":
{ Args: { "p_confirm": string }; Returns: Json
                           },
"admin_retry_notification":
{ Args: { "p_id": number }; Returns: undefined
                           },
"admin_review_payment":
{ Args: { "p_decision": string,"p_note"?: string,"p_submission_id": string }; Returns: undefined
                           },
"admin_review_topup":
{ Args: { "p_decision": string,"p_note"?: string,"p_topup_id": string }; Returns: Json
                           },
"admin_revoke_promotion":
{ Args: { "p_promotion_id": string,"p_reason": string }; Returns: undefined
                           },
"admin_sales_report":
{ Args: { "p_from": string,"p_to": string }; Returns: Json
                           },
"admin_save_kpi_target":
{ Args: { "p_metric": string,"p_period": string,"p_profile_id"?: string,"p_target": number }; Returns: undefined
                           },
"admin_save_partner_shop":
{ Args: { "p": Json,"p_id": string }; Returns: string
                           },
"admin_save_role":
{ Args: { "p_description": string,"p_name": string,"p_permissions": (string)[],"p_role_id": number }; Returns: number
                           },
"admin_save_staff_hr":
{ Args: { "p": Json,"p_profile": string }; Returns: undefined
                           },
"admin_security_events":
{ Args: { "p_email"?: string,"p_from"?: string,"p_kind"?: string,"p_limit"?: number,"p_search"?: string,"p_to"?: string }; Returns: {
              "created_at": string,"email": string,"id": number,"ip_hash": string,"kind": string,"metadata": Json,"user_agent": string,"user_name": string
            }[]
                           },
"admin_security_reviews":
{ Args: { "p_limit"?: number }; Returns: {
              "note": string,"reviewed_at": string,"reviewed_by_name": string,"subject": string,"subject_type": string
            }[]
                           },
"admin_set_auto_assign":
{ Args: { "p_on": boolean }; Returns: undefined
                           },
"admin_set_courier_fee":
{ Args: { "p_fee": number }; Returns: undefined
                           },
"admin_set_courier_ringtone":
{ Args: { "p_path": string }; Returns: undefined
                           },
"admin_set_customer_active":
{ Args: { "p_active": boolean,"p_reason"?: string,"p_user_id": string }; Returns: undefined
                           },
"admin_set_delivery_monitor":
{ Args: { "p": Json }; Returns: undefined
                           },
"admin_set_member_permissions":
{ Args: { "p_permissions": (string)[],"p_user_id": string }; Returns: undefined
                           },
"admin_set_partner_staff":
{ Args: { "p_profile": string,"p_shop": string }; Returns: undefined
                           },
"admin_set_pending_payment_alerts":
{ Args: { "p_on": boolean }; Returns: undefined
                           },
"admin_set_receipt_archive":
{ Args: { "p_email": string }; Returns: undefined
                           },
"admin_set_staff_role":
{ Args: { "p_is_active": boolean,"p_role_key": string,"p_user_id": string }; Returns: undefined
                           },
"admin_set_telegram_feed":
{ Args: { "p_admin": boolean,"p_notifications": boolean,"p_order_progress"?: boolean,"p_printing_requests"?: boolean,"p_security": boolean }; Returns: undefined
                           },
"admin_sign_out_user":
{ Args: { "p_user_id": string }; Returns: number
                           },
"admin_signed_in_users":
{ Args: { "p_search"?: string }; Returns: {
              "email": string,"full_name": string,"ip": string,"is_staff": boolean,"last_active_at": string,"member_id": string,"role_name": string,"session_id": string,"signed_in_at": string,"user_agent": string,"user_id": string
            }[]
                           },
"admin_staff_kpis":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "full_name": string,"instore_sales": number,"instore_sales_etb": number,"is_active": boolean,"member_id": string,"order_steps": number,"orders_completed": number,"payment_review_minutes": number,"payments_approved": number,"payments_rejected": number,"printing_completed": number,"role_name": string,"ticket_first_reply_hours": number,"ticket_rating": number,"ticket_replies": number,"ticket_resolution_hours": number,"tickets_resolved": number,"topups_approved": number,"topups_rejected": number,"user_id": string
            }[]
                           },
"admin_stalled_checkouts":
{ Args: { "p_hours"?: number }; Returns: {
              "amount_etb": number,"email": string,"entity_id": string,"full_name": string,"item_count": number,"items": Json,"kind": string,"phone": string,"reference": string,"since": string,"status": string,"user_id": string
            }[]
                           },
"admin_support_tickets":
{ Args: { "p_from"?: string,"p_limit"?: number,"p_search"?: string,"p_status"?: string,"p_to"?: string }; Returns: {
              "assigned_name": string,"category": string,"closed_at": string,"created_at": string,"customer_name": string,"details": string,"email": string,"id": string,"last_message_at": string,"member_id": string,"messages": number,"order_id": string,"order_number": string,"rating": number,"rating_comment": string,"resolved_at": string,"status": string,"subject": string,"ticket_number": string,"user_id": string
            }[]
                           },
"admin_suspicious_customers":
{ Args: { "p_days"?: number }; Returns: {
              "blocked": boolean,"cancelled_unpaid": number,"deactivated": boolean,"email": string,"expired_orders": number,"failed_logins": number,"full_name": string,"idle_basket_hours": number,"reasons": (string)[],"rejected_payments": number,"rejected_topups": number,"reused_receipts": number,"user_id": string
            }[]
                           },
"admin_suspicious_emails":
{ Args: { "p_days"?: number }; Returns: {
              "blocked": boolean,"blocked_attempts": number,"email": string,"failed_admin": number,"failed_customer": number,"failed_mfa": number,"has_account": boolean,"is_staff": boolean,"last_seen": string,"networks": number,"rate_limited": number,"score": number
            }[]
                           },
"admin_system_health":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_telegram_feed":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_topups_export":
{ Args: { "p_from": string,"p_status"?: string,"p_to": string }; Returns: {
              "account_number": string,"amount_etb": number,"bank_name": string,"created_at": string,"customer_email": string,"customer_name": string,"id": string,"review_note": string,"reviewed_at": string,"reviewed_by_name": string,"status": string,"topup_number": string,"transaction_reference": string
            }[]
                           },
"admin_unassign_promotion":
{ Args: { "p_promotion_id": string,"p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"admin_unblock_email":
{ Args: { "p_email": string }; Returns: Json
                           },
"admin_update_courier":
{ Args: { "p": Json,"p_courier": string }; Returns: undefined
                           },
"admin_update_customer_details":
{ Args: { "p_date_of_birth"?: string,"p_full_name": string,"p_old_email"?: string,"p_phone": string,"p_sex"?: string,"p_user_id": string }; Returns: undefined
                           },
"admin_update_order_status":
{ Args: { "p_note"?: string,"p_order_id": string,"p_status": Database["public"]['Enums']["order_status"] }; Returns: undefined
                           },
"admin_update_printing_status":
{ Args: { "p_job_id": string,"p_note"?: string,"p_status": Database["public"]['Enums']["print_job_status"] }; Returns: undefined
                           },
"admin_update_staff_details":
{ Args: { "p_date_of_birth": string,"p_full_name": string,"p_phone": string,"p_sex": string,"p_user_id": string }; Returns: undefined
                           },
"admin_update_ticket":
{ Args: { "p_assigned_to"?: string,"p_internal"?: boolean,"p_message"?: string,"p_status"?: string,"p_ticket_id": string,"p_unassign"?: boolean }; Returns: undefined
                           },
"admin_void_instore_sale":
{ Args: { "p_order_id": string,"p_reason": string }; Returns: undefined
                           },
"admin_wallet_balances":
{ Args: { "p_limit"?: number,"p_search"?: string }; Returns: {
              "balance_etb": number,"email": string,"full_name": string,"last_activity": string,"user_id": string
            }[]
                           },
"approve_invited_customer":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"bootstrap_super_admin":
{ Args: { "p_full_name": string,"p_user_id": string }; Returns: undefined
                           },
"cancel_stock_alert":
{ Args: { "p_product_id": string }; Returns: undefined
                           },
"check_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"claim_notifications":
{ Args: { "p_limit"?: number }; Returns: {
              "attachment_bucket": string | null,
"attachment_path": string | null,
"attempts": number,
"channel": string,
"created_at": string,
"dedupe_key": string,
"event_type": string,
"id": number,
"last_error": string | null,
"locked_until": string | null,
"max_attempts": number,
"next_attempt_at": string,
"payload": NonNullable<Json>,
"recipient_user_id": string | null,
"sent_at": string | null,
"status": Database["public"]['Enums']["notification_status"]
            }[]
                          SetofOptions: {
        from: "*"
        to: "notifications_outbox"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_outbox":
{ Args: { "p_channel": string,"p_limit"?: number }; Returns: {
              "attachment_bucket": string | null,
"attachment_path": string | null,
"attempts": number,
"channel": string,
"created_at": string,
"dedupe_key": string,
"event_type": string,
"id": number,
"last_error": string | null,
"locked_until": string | null,
"max_attempts": number,
"next_attempt_at": string,
"payload": NonNullable<Json>,
"recipient_user_id": string | null,
"sent_at": string | null,
"status": Database["public"]['Enums']["notification_status"]
            }[]
                          SetofOptions: {
        from: "*"
        to: "notifications_outbox"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_push_device":
{ Args: { "p_auth": string,"p_endpoint": string,"p_locale"?: string,"p_p256dh": string }; Returns: undefined
                           },
"claim_telegram":
{ Args: { "p_limit"?: number,"p_security": boolean }; Returns: {
              "attachment_bucket": string | null,
"attachment_path": string | null,
"attempts": number,
"channel": string,
"created_at": string,
"dedupe_key": string,
"event_type": string,
"id": number,
"last_error": string | null,
"locked_until": string | null,
"max_attempts": number,
"next_attempt_at": string,
"payload": NonNullable<Json>,
"recipient_user_id": string | null,
"sent_at": string | null,
"status": Database["public"]['Enums']["notification_status"]
            }[]
                          SetofOptions: {
        from: "*"
        to: "notifications_outbox"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_telegram_groups":
{ Args: { "p_groups": (string)[],"p_limit"?: number }; Returns: {
              "attachment_bucket": string | null,
"attachment_path": string | null,
"attempts": number,
"channel": string,
"created_at": string,
"dedupe_key": string,
"event_type": string,
"id": number,
"last_error": string | null,
"locked_until": string | null,
"max_attempts": number,
"next_attempt_at": string,
"payload": NonNullable<Json>,
"recipient_user_id": string | null,
"sent_at": string | null,
"status": Database["public"]['Enums']["notification_status"]
            }[]
                          SetofOptions: {
        from: "*"
        to: "notifications_outbox"
        isOneToOne: false
        isSetofReturn: true
      } },
"close_stale_tickets":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"complete_notification":
{ Args: { "p_error"?: string,"p_id": number,"p_success": boolean }; Returns: undefined
                           },
"courier_available":
{ Args: Record<PropertyKey, never>; Returns: {
              "city": string,"order_id": string,"order_number": string,"paid_at": string,"partner_shop": string,"pay_etb": number
            }[]
                           },
"courier_cities":
{ Args: Record<PropertyKey, never>; Returns: {
              "id": string,"name_en": string
            }[]
                           },
"courier_decline":
{ Args: { "p_order_id": string,"p_reason": string }; Returns: undefined
                           },
"courier_deliver":
{ Args: { "p_code": string,"p_order_id": string }; Returns: boolean
                           },
"courier_deliveries":
{ Args: Record<PropertyKey, never>; Returns: {
              "active": boolean,"address_line": string,"assigned_at": string,"cancel_note": string,"city": string,"customer_name": string,"customer_phone": string,"delivered_at": string,"delivery_instructions": string,"fail_reason": string,"handoff_code": string,"handoff_courier_done": boolean,"handoff_shop_done": boolean,"order_id": string,"order_number": string,"partner_hours": string,"partner_landmark": string,"partner_map_url": string,"partner_phone": string,"partner_shop": string,"picked_up_at": string,"status": string
            }[]
                           },
"courier_fail":
{ Args: { "p_order_id": string,"p_reason": string }; Returns: undefined
                           },
"courier_handoff":
{ Args: { "p_order_id": string,"p_shop_code": string }; Returns: boolean
                           },
"courier_mark_notifications_read":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"courier_me":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"courier_pick_up":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"courier_set_duty":
{ Args: { "p_on": boolean,"p_zone_ids"?: (string)[] }; Returns: undefined
                           },
"courier_take":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"courier_update_details":
{ Args: { "p_phone": string }; Returns: undefined
                           },
"create_order":
{ Args: { "p_input": Json }; Returns: Json
                           },
"create_order_for_user":
{ Args: { "p_input": Json,"p_user_id": string }; Returns: Json
                           },
"create_printing_job":
{ Args: { "p_input": Json }; Returns: Json
                           },
"create_printing_job_for_user":
{ Args: { "p_input": Json,"p_user_id": string }; Returns: Json
                           },
"customer_cancel_order":
{ Args: { "p_order_id": string,"p_reason"?: string }; Returns: undefined
                           },
"customer_create_ticket":
{ Args: { "p_category": string,"p_details": string,"p_order_number": string,"p_subject": string }; Returns: Json
                           },
"customer_rate_ticket":
{ Args: { "p_comment"?: string,"p_rating": number,"p_ticket_id": string }; Returns: undefined
                           },
"customer_reply_ticket":
{ Args: { "p_body": string,"p_ticket_id": string }; Returns: undefined
                           },
"delete_my_product_review":
{ Args: { "p_product_id": string }; Returns: undefined
                           },
"delivery_monitor_tick":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"expire_unpaid_orders":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"is_email_blocked":
{ Args: { "p_email": string }; Returns: boolean
                           },
"mark_printing_files_deleted":
{ Args: { "p_file_ids": (string)[] }; Returns: number
                           },
"my_admin_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_offers":
{ Args: Record<PropertyKey, never>; Returns: {
              "code": string,"description_am": string,"description_en": string,"discount_type": string,"discount_value": number,"ends_at": string,"min_order_etb": number,"title_am": string,"title_en": string
            }[]
                           },
"my_product_review":
{ Args: { "p_product_id": string }; Returns: Json
                           },
"my_staff_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"partner_hand_over":
{ Args: { "p_order_id": string,"p_pin": string }; Returns: boolean
                           },
"partner_me":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"partner_orders":
{ Args: Record<PropertyKey, never>; Returns: {
              "at_shop_at": string,"cancel_note": string,"cancelled_at": string,"collected_at": string,"courier_confirmed": boolean,"courier_name": string,"courier_phone": string,"customer_name": string,"customer_phone": string,"handoff_locked": boolean,"order_id": string,"order_number": string,"paid_at": string,"pin_locked": boolean,"shop_code": string,"shop_confirmed": boolean,"stage": string,"status": string
            }[]
                           },
"partner_receive":
{ Args: { "p_courier_code": string,"p_order_id": string }; Returns: boolean
                           },
"printing_files_due_for_deletion":
{ Args: { "p_limit"?: number }; Returns: {
              "file_id": string,"job_id": string,"storage_path": string
            }[]
                           },
"public_partner_shops":
{ Args: Record<PropertyKey, never>; Returns: {
              "address_line": string,"city": string,"city_am": string,"fee_etb": number,"id": string,"landmark": string,"map_url": string,"name": string,"opening_hours": string,"phone": string,"zone_id": string
            }[]
                           },
"purge_security_events":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"purge_stale_telegram_feed":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"push_targets":
{ Args: { "p_user_id": string }; Returns: {
              "auth": string,"endpoint": string,"id": string,"locale": string,"p256dh": string
            }[]
                           },
"queue_excel_copy":
{ Args: { "p_by"?: string,"p_file_name": string,"p_path": string,"p_rows"?: number,"p_title": string }; Returns: undefined
                           },
"quote_printing":
{ Args: { "p_color": Database["public"]['Enums']["print_color_mode"],"p_copies": number,"p_page_count": number,"p_paper_size": string,"p_sides": Database["public"]['Enums']["print_sides"] }; Returns: Json
                           },
"quote_promotion":
{ Args: { "p_code": string,"p_items": Json,"p_user_id": string }; Returns: Json
                           },
"receipt_archive_email":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"record_app_install":
{ Args: { "p_device_id": string,"p_platform": string,"p_user_id"?: string }; Returns: undefined
                           },
"record_cron_run":
{ Args: { "p_detail"?: Json,"p_name": string,"p_ok": boolean }; Returns: undefined
                           },
"record_security_event":
{ Args: { "p_email"?: string,"p_ip_hash"?: string,"p_kind": string,"p_metadata"?: Json,"p_user_agent"?: string,"p_user_id"?: string }; Returns: undefined
                           },
"record_upload_scan":
{ Args: { "p_duration_ms"?: number,"p_file_type": string,"p_findings"?: string,"p_ref": string,"p_result": string,"p_sha256": string,"p_size": number,"p_source": string,"p_user_id": string }; Returns: undefined
                           },
"request_stock_alert":
{ Args: { "p_product_id": string }; Returns: undefined
                           },
"reset_storage_leftovers":
{ Args: { "p_before": string,"p_limit"?: number }; Returns: {
              "bucket": string,"name": string
            }[]
                           },
"session_is_current":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"signup_email_allowed":
{ Args: { "p_email": string }; Returns: boolean
                           },
"storage_orphans":
{ Args: { "p_limit"?: number,"p_min_age"?: string }; Returns: {
              "bucket": string,"name": string
            }[]
                           },
"submit_payment":
{ Args: { "p_input": Json }; Returns: Json
                           },
"submit_product_review":
{ Args: { "p_body"?: string,"p_product_id": string,"p_rating": number }; Returns: undefined
                           },
"submit_wallet_topup":
{ Args: { "p_input": Json,"p_user_id": string }; Returns: Json
                           }
          }
          Enums: {
            "department": "cosmetics"|"electronics"|"printing","fulfillment_method": "delivery"|"pickup","inventory_reason": "initial"|"restock"|"adjustment"|"damage"|"return"|"order_reserved"|"order_released","notification_status": "pending"|"processing"|"sent"|"failed"|"dead","order_item_type": "product"|"printing","order_status": "awaiting_payment"|"pending_verification"|"payment_rejected"|"confirmed"|"processing"|"ready_for_pickup"|"out_for_delivery"|"completed"|"cancelled"|"expired","payment_status": "unpaid"|"pending_verification"|"verified"|"rejected"|"refunded","print_color_mode": "bw"|"color","print_job_status": "submitted"|"awaiting_quote"|"awaiting_payment"|"payment_verification"|"printing"|"ready"|"completed"|"cancelled","print_sides": "single"|"double","product_status": "draft"|"active"|"archived","submission_status": "pending"|"verified"|"rejected"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "department": ["cosmetics", "electronics", "printing"],"fulfillment_method": ["delivery", "pickup"],"inventory_reason": ["initial", "restock", "adjustment", "damage", "return", "order_reserved", "order_released"],"notification_status": ["pending", "processing", "sent", "failed", "dead"],"order_item_type": ["product", "printing"],"order_status": ["awaiting_payment", "pending_verification", "payment_rejected", "confirmed", "processing", "ready_for_pickup", "out_for_delivery", "completed", "cancelled", "expired"],"payment_status": ["unpaid", "pending_verification", "verified", "rejected", "refunded"],"print_color_mode": ["bw", "color"],"print_job_status": ["submitted", "awaiting_quote", "awaiting_payment", "payment_verification", "printing", "ready", "completed", "cancelled"],"print_sides": ["single", "double"],"product_status": ["draft", "active", "archived"],"submission_status": ["pending", "verified", "rejected"]
          }
        }
} as const
