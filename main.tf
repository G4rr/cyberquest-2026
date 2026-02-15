# --- 1. НАЛАШТУВАННЯ ПРОВАЙДЕРА ---
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# --- 2. ЗМІННІ ---
variable "project_id" { default = "alphahome-484017" }
variable "region"     { default = "europe-west3" }
variable "bucket_name" { default = "cyberquest-for-school-2026" }
variable "admin_pass" { 
  default = "cyber-admin-2026" 
  sensitive = true 
}

# --- 3. FRONTEND (Cloud Storage) ---
resource "google_storage_bucket" "frontend" {
  name          = var.bucket_name
  location      = var.region
  force_destroy = true

  website {
    main_page_suffix = "index.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "POST", "PUT", "OPTIONS"]
    response_header = ["*"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_member" "public_access" {
  bucket = google_storage_bucket.frontend.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Автоматичне завантаження всіх файлів з папки ./frontend
locals {
  frontend_files = {
    "index.html"    = "text/html"
    "admin.html"    = "text/html"
    "style.css"     = "text/css"
    "script.js"     = "application/javascript"
    "questions.js"  = "application/javascript"
  }
}

resource "google_storage_bucket_object" "frontend_assets" {
  for_each      = local.frontend_files
  name          = each.key
  bucket        = google_storage_bucket.frontend.name
  source        = "./frontend/${each.key}"
  content_type  = each.value
  cache_control = "no-cache, max-age=0" # ВИРІШУЄ ПРОБЛЕМУ КЕШУВАННЯ
}

# --- 4. DATABASE (Firestore) ---
resource "google_firestore_database" "database" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  deletion_policy = "DELETE"
}

# Сервісний акаунт для функцій
resource "google_service_account" "quiz_sa" {
  account_id   = "sa-for-presentation"
  display_name = "Service Account for CyberQuest"
}

resource "google_project_iam_member" "cf_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.quiz_sa.email}"
}

# --- 5. BACKEND (Cloud Functions v2) ---
resource "google_storage_bucket" "function_bucket" {
  name     = "${var.project_id}-gcf-source"
  location = var.region
}

data "archive_file" "function_zip" {
  type        = "zip"
  source_dir  = "./backend"
  output_path = "./backend.zip"
}

resource "google_storage_bucket_object" "function_code" {
  name   = "backend-${data.archive_file.function_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_bucket.name
  source = data.archive_file.function_zip.output_path
}

resource "google_cloudfunctions2_function" "leaderboard_api" {
  name        = "manage-leaderboard"
  location    = var.region
  description = "API для синхронної битви CyberQuest"

  build_config {
    runtime     = "python310"
    entry_point = "manage_leaderboard"
    source {
      storage_source {
        bucket = google_storage_bucket.function_bucket.name
        object = google_storage_bucket_object.function_code.name
      }
    }
  }

  service_config {
    max_instance_count = 5
    available_memory   = "256Mi"
    timeout_seconds    = 60
    ingress_settings   = "ALLOW_ALL"
    
    environment_variables = {
      ADMIN_PASSWORD = var.admin_pass # ПАРОЛЬ НЕ В КОДІ PYTHON
    }

    service_account_email = google_service_account.quiz_sa.email
  }

  depends_on = [google_project_iam_member.cf_firestore_user]
}

resource "google_cloud_run_service_iam_member" "public_invoker" {
  location = google_cloudfunctions2_function.leaderboard_api.location
  service  = google_cloudfunctions2_function.leaderboard_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- 6. СКЛАДЕНІ ІНДЕКСИ (Для сортування лідерборду) ---
resource "google_firestore_index" "leaderboard_composite" {
  project    = var.project_id
  database   = "(default)"
  collection = "leaderboard"

  fields { field_path = "score";     order = "DESCENDING" }
  fields { field_path = "timestamp"; order = "DESCENDING" }
}

resource "google_firestore_index" "teams_idx" {
  project    = var.project_id
  database   = "(default)"
  collection = "teams"
  fields { field_path = "total_score"; order = "DESCENDING" }
}

# --- 7. OUTPUTS ---
output "frontend_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.frontend.name}/index.html"
}
output "admin_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.frontend.name}/admin.html"
}
output "api_endpoint" {
  value = google_cloudfunctions2_function.leaderboard_api.url
}