# --- НАЛАШТУВАННЯ ПРОВАЙДЕРА ---
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

variable "project_id" { default = "alphahome-484017" }
variable "region"     { default = "europe-west3" }
variable "bucket_name" { default = "cyberquest-2026" }

# --- 1. FRONTEND (GCS Bucket) ---
resource "google_storage_bucket" "frontend" {
  name          = var.bucket_name
  location      = var.region
  force_destroy = true

  website {
    main_page_suffix = "index.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "POST", "PUT", "OPTIONS"] # Додано PUT для адмінки
    response_header = ["*"]
    max_age_seconds = 3600
  }
}

# Робимо бакет публічним
resource "google_storage_bucket_iam_member" "public_access" {
  bucket = google_storage_bucket.frontend.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# МАСИВ ФАЙЛІВ ФРОНТЕНДУ (Автоматичне завантаження всіх частин)
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
  for_each     = local.frontend_files
  name         = each.key
  bucket       = google_storage_bucket.frontend.name
  source       = "./frontend/${each.key}"
  content_type = each.value
  
  cache_control = "no-cache, max-age=0"
}

# --- 2. DATABASE (Firestore) ---
resource "google_firestore_database" "database" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  deletion_policy = "DELETE"
}

# Надаємо права акаунту на Firestore
resource "google_project_iam_member" "cf_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:sa-for-presentation@alphahome-484017.iam.gserviceaccount.com"
}

# --- 3. BACKEND (Cloud Functions v2) ---

resource "google_storage_bucket" "function_bucket" {
  name     = "${var.project_id}-gcf-source"
  location = var.region
}

# Архівуємо код (переконайся, що teams_config.json лежить у /backend)
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
      ADMIN_PASSWORD = "123456" # CHANGE ME
    }
    
    # Використовуємо створений вище акаунт
    service_account_email = "sa-for-presentation@alphahome-484017.iam.gserviceaccount.com"
  }

  depends_on = [google_project_iam_member.cf_firestore_user]
}

resource "google_cloud_run_service_iam_member" "public_invoker" {
  location = google_cloudfunctions2_function.leaderboard_api.location
  service  = google_cloudfunctions2_function.leaderboard_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- ІНДЕКСИ FIRESTORE ---
resource "google_firestore_index" "leaderboard_idx" {
  project    = var.project_id
  database   = "(default)"
  collection = "leaderboard"
  fields { 
    field_path = "score"
    order = "DESCENDING" 
  }
  fields { 
    field_path = "timestamp" 
    order = "DESCENDING" 
  }
}

resource "google_firestore_index" "teams_idx" {
  project    = var.project_id
  database   = "(default)"
  collection = "teams"
  fields { 
    field_path = "total_score"
    order = "DESCENDING" 
  }
  fields { 
    field_path = "timestamp" 
    order = "DESCENDING" 
  }
}

# --- ВИХІДНІ ДАНІ ---
output "frontend_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.frontend.name}/index.html"
}

output "admin_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.frontend.name}/admin.html"
}

output "api_endpoint" {
  value = google_cloudfunctions2_function.leaderboard_api.url
}

# Якщо хочеш завантажувати всі картинки з папки автоматично
resource "google_storage_bucket_object" "quiz_images" {
  for_each     = fileset("${path.module}/frontend/img/", "*")
  name         = "img/${each.value}"
  bucket       = google_storage_bucket.frontend.name
  source       = "./frontend/img/${each.value}"
  content_type = "image/jpeg" # Або інший тип залежно від файлів
}
