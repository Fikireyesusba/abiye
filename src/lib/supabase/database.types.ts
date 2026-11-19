
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
                    "created_at": string,"description": string | null,"id": number,"key": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: never,"key": string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: never,"key"?: string,"name"?: string
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
                },"customer_accounts": {
                  Row: {
                    "accepted_terms_at": string | null,"created_at": string,"deactivated_at": string | null,"deactivated_by": string | null,"deactivation_reason": string | null,"full_name": string | null,"id": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_terms_at"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_reason"?: string | null,"full_name"?: string | null,"id": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "accepted_terms_at"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_reason"?: string | null,"full_name"?: string | null,"id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
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
                    "access_token_hash": string,"address_line": string | null,"assigned_to": string | null,"bank_account_id": string | null,"bank_snapshot": NonNullable<Json>,"cancelled_at": string | null,"city": string | null,"created_at": string,"currency": string,"customer_id": string,"customer_name": string,"customer_phone": string,"delivery_fee_etb": number,"delivery_instructions": string | null,"delivery_zone_id": string | null,"discount_etb": number,"fulfillment_method": Database["public"]['Enums']["fulfillment_method"],"id": string,"idempotency_key": string,"locale": string,"order_number": string,"payment_due_at": string,"payment_status": Database["public"]['Enums']["payment_status"],"payment_verified_at": string | null,"payment_verified_by": string | null,"promotion_id": string | null,"status": Database["public"]['Enums']["order_status"],"subtotal_etb": number,"total_etb": number,"tracking_code_hash": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token_hash": string,"address_line"?: string | null,"assigned_to"?: string | null,"bank_account_id"?: string | null,"bank_snapshot": NonNullable<Json>,"cancelled_at"?: string | null,"city"?: string | null,"created_at"?: string,"currency"?: string,"customer_id": string,"customer_name": string,"customer_phone": string,"delivery_fee_etb"?: number,"delivery_instructions"?: string | null,"delivery_zone_id"?: string | null,"discount_etb"?: number,"fulfillment_method": Database["public"]['Enums']["fulfillment_method"],"id"?: string,"idempotency_key": string,"locale"?: string,"order_number"?: string,"payment_due_at": string,"payment_status"?: Database["public"]['Enums']["payment_status"],"payment_verified_at"?: string | null,"payment_verified_by"?: string | null,"promotion_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"subtotal_etb": number,"total_etb": number,"tracking_code_hash": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "access_token_hash"?: string,"address_line"?: string | null,"assigned_to"?: string | null,"bank_account_id"?: string | null,"bank_snapshot"?: NonNullable<Json>,"cancelled_at"?: string | null,"city"?: string | null,"created_at"?: string,"currency"?: string,"customer_id"?: string,"customer_name"?: string,"customer_phone"?: string,"delivery_fee_etb"?: number,"delivery_instructions"?: string | null,"delivery_zone_id"?: string | null,"discount_etb"?: number,"fulfillment_method"?: Database["public"]['Enums']["fulfillment_method"],"id"?: string,"idempotency_key"?: string,"locale"?: string,"order_number"?: string,"payment_due_at"?: string,"payment_status"?: Database["public"]['Enums']["payment_status"],"payment_verified_at"?: string | null,"payment_verified_by"?: string | null,"promotion_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"subtotal_etb"?: number,"total_etb"?: number,"tracking_code_hash"?: string,"updated_at"?: string,"user_id"?: string | null
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
      foreignKeyName: "orders_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotions"
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
                },"products": {
                  Row: {
                    "archived_at": string | null,"brand": string | null,"category_id": string,"created_at": string,"created_by": string | null,"description_am": string,"description_en": string,"effective_price_etb": number | null,"id": string,"is_featured": boolean,"low_stock_threshold": number,"name_am": string,"name_en": string,"price_etb": number,"sale_price_etb": number | null,"sku": string,"slug": string,"status": Database["public"]['Enums']["product_status"],"stock_quantity": number,"track_inventory": boolean,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"brand"?: string | null,"category_id": string,"created_at"?: string,"created_by"?: string | null,"description_am"?: string,"description_en"?: string,"effective_price_etb"?: never,"id"?: string,"is_featured"?: boolean,"low_stock_threshold"?: number,"name_am": string,"name_en": string,"price_etb": number,"sale_price_etb"?: number | null,"sku": string,"slug": string,"status"?: Database["public"]['Enums']["product_status"],"stock_quantity"?: number,"track_inventory"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"brand"?: string | null,"category_id"?: string,"created_at"?: string,"created_by"?: string | null,"description_am"?: string,"description_en"?: string,"effective_price_etb"?: never,"id"?: string,"is_featured"?: boolean,"low_stock_threshold"?: number,"name_am"?: string,"name_en"?: string,"price_etb"?: number,"sale_price_etb"?: number | null,"sku"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["product_status"],"stock_quantity"?: number,"track_inventory"?: boolean,"updated_at"?: string,"updated_by"?: string | null
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
                },"profiles": {
                  Row: {
                    "created_at": string,"created_by": string | null,"full_name": string,"id": string,"is_active": boolean,"phone": string | null,"role_id": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"full_name": string,"id": string,"is_active"?: boolean,"phone"?: string | null,"role_id": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string | null,"role_id"?: number,"updated_at"?: string
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
                    "created_at": string,"created_by": string | null,"promotion_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"promotion_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"promotion_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_customers_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id"]
    }
                  ]
                },"promotions": {
                  Row: {
                    "category_id": string | null,"code": string | null,"created_at": string,"description_am": string,"description_en": string,"discount_type": string,"discount_value": number,"ends_at": string | null,"id": string,"is_active": boolean,"max_redemptions": number | null,"min_order_etb": number,"once_per_customer": boolean,"product_id": string | null,"restricted": boolean,"show_on_homepage": boolean,"starts_at": string | null,"title_am": string,"title_en": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"code"?: string | null,"created_at"?: string,"description_am"?: string,"description_en"?: string,"discount_type": string,"discount_value": number,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"max_redemptions"?: number | null,"min_order_etb"?: number,"once_per_customer"?: boolean,"product_id"?: string | null,"restricted"?: boolean,"show_on_homepage"?: boolean,"starts_at"?: string | null,"title_am": string,"title_en": string,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"code"?: string | null,"created_at"?: string,"description_am"?: string,"description_en"?: string,"discount_type"?: string,"discount_value"?: number,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"max_redemptions"?: number | null,"min_order_etb"?: number,"once_per_customer"?: boolean,"product_id"?: string | null,"restricted"?: boolean,"show_on_homepage"?: boolean,"starts_at"?: string | null,"title_am"?: string,"title_en"?: string,"updated_at"?: string
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
            "admin_activity_log":
{ Args: { "p_before_id"?: number,"p_entity_type"?: string,"p_limit"?: number,"p_search"?: string }; Returns: {
              "action": string,"actor_id": string,"actor_name": string,"actor_role": string,"after_data": Json,"before_data": Json,"created_at": string,"entity_id": string,"entity_label": string,"entity_type": string,"id": number,"metadata": Json
            }[]
                           },
"admin_adjust_stock":
{ Args: { "p_change": number,"p_note"?: string,"p_product_id": string,"p_reason": Database["public"]['Enums']["inventory_reason"] }; Returns: number
                           },
"admin_analytics":
{ Args: { "p_bucket"?: string,"p_from": string,"p_to": string }; Returns: Json
                           },
"admin_assign_order":
{ Args: { "p_assignee": string,"p_order_id": string }; Returns: undefined
                           },
"admin_assign_promotion":
{ Args: { "p_emails": (string)[],"p_promotion_id": string }; Returns: Json
                           },
"admin_create_staff_profile":
{ Args: { "p_full_name": string,"p_role_key": string,"p_user_id": string }; Returns: undefined
                           },
"admin_customer_accounts":
{ Args: { "p_limit"?: number,"p_search"?: string,"p_user_id"?: string }; Returns: {
              "created_at": string,"deactivated_at": string,"deactivated_by_name": string,"deactivation_reason": string,"email": string,"email_confirmed_at": string,"full_name": string,"id": string,"is_staff": boolean,"last_order_at": string,"last_sign_in_at": string,"order_count": number,"phone": string
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
"admin_log_customer_action":
{ Args: { "p_action": string,"p_metadata"?: Json,"p_user_id": string }; Returns: undefined
                           },
"admin_log_mfa_reset":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"admin_mark_printing_files_deleted":
{ Args: { "p_job_id": string }; Returns: number
                           },
"admin_notifications":
{ Args: { "p_limit"?: number }; Returns: {
              "attempts": number,"created_at": string,"event_type": string,"id": number,"last_error": string,"max_attempts": number,"next_attempt_at": string,"reference": string,"sent_at": string,"status": Database["public"]['Enums']["notification_status"]
            }[]
                           },
"admin_prepare_customer_delete":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"admin_promotion_customers":
{ Args: { "p_promotion_id"?: string,"p_user_id"?: string }; Returns: {
              "assigned_at": string,"code": string,"email": string,"full_name": string,"promotion_id": string,"title_en": string,"used": boolean,"user_id": string
            }[]
                           },
"admin_queue_test_notification":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"admin_quote_printing_job":
{ Args: { "p_job_id": string,"p_note"?: string,"p_page_count": number,"p_total_etb"?: number }; Returns: Json
                           },
"admin_retry_notification":
{ Args: { "p_id": number }; Returns: undefined
                           },
"admin_review_payment":
{ Args: { "p_decision": string,"p_note"?: string,"p_submission_id": string }; Returns: undefined
                           },
"admin_set_customer_active":
{ Args: { "p_active": boolean,"p_reason"?: string,"p_user_id": string }; Returns: undefined
                           },
"admin_set_staff_role":
{ Args: { "p_is_active": boolean,"p_role_key": string,"p_user_id": string }; Returns: undefined
                           },
"admin_stalled_checkouts":
{ Args: { "p_hours"?: number }; Returns: {
              "amount_etb": number,"email": string,"entity_id": string,"full_name": string,"item_count": number,"items": Json,"kind": string,"phone": string,"reference": string,"since": string,"status": string,"user_id": string
            }[]
                           },
"admin_update_order_status":
{ Args: { "p_note"?: string,"p_order_id": string,"p_status": Database["public"]['Enums']["order_status"] }; Returns: undefined
                           },
"admin_update_printing_status":
{ Args: { "p_job_id": string,"p_note"?: string,"p_status": Database["public"]['Enums']["print_job_status"] }; Returns: undefined
                           },
"bootstrap_super_admin":
{ Args: { "p_full_name": string,"p_user_id": string }; Returns: undefined
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
"complete_notification":
{ Args: { "p_error"?: string,"p_id": number,"p_success": boolean }; Returns: undefined
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
"expire_unpaid_orders":
{ Args: Record<PropertyKey, never>; Returns: number
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
"my_staff_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"printing_files_due_for_deletion":
{ Args: { "p_limit"?: number }; Returns: {
              "file_id": string,"job_id": string,"storage_path": string
            }[]
                           },
"quote_printing":
{ Args: { "p_color": Database["public"]['Enums']["print_color_mode"],"p_copies": number,"p_page_count": number,"p_paper_size": string,"p_sides": Database["public"]['Enums']["print_sides"] }; Returns: Json
                           },
"quote_promotion":
{ Args: { "p_code": string,"p_items": Json,"p_user_id": string }; Returns: Json
                           },
"storage_orphans":
{ Args: { "p_limit"?: number,"p_min_age"?: string }; Returns: {
              "bucket": string,"name": string
            }[]
                           },
"submit_payment":
{ Args: { "p_input": Json }; Returns: Json
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
