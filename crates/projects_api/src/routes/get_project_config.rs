use axum::{
  debug_handler,
  extract::{Path, State},
  Json,
};
use mosaic_utils::{ApiErrorResponse, AppError, AppState, MosaicConfig};
use uuid::Uuid;

use crate::TAG;

#[utoipa::path(
  get,
  path = "/api/v1/projects/{project_id}/config",
  tag = TAG,
  responses(
    (status = OK, description = "List of Projects"),
    (status = INTERNAL_SERVER_ERROR, description = "Internal server error")
  )
)]
#[debug_handler]
pub async fn handler(
  Path(project_id): Path<Uuid>,
  State(state): State<AppState>,
) -> Result<Json<MosaicConfig>, ApiErrorResponse> {
  match sqlx::query_scalar!("SELECT config FROM projects WHERE id = $1", project_id)
    .fetch_one(&state.db)
    .await
  {
    Ok(raw_config) => {
      let config: MosaicConfig = serde_json::from_value(raw_config).map_err(|err| {
        tracing::error!("Failed to parse config: {:?}", err);
        ApiErrorResponse::from(AppError::SerdeJsonError(err))
      })?;

      Ok(Json(config))
    }
    Err(err) => {
      if let sqlx::Error::RowNotFound = err {
        return Err(ApiErrorResponse::from(AppError::NotFound));
      }

      tracing::error!("Failed to fetch projects: {:?}", err);
      Err(ApiErrorResponse::from(AppError::SqlxError(err)))
    }
  }
}