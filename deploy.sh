#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' is not installed." >&2
    exit 1
  fi
}

prompt_with_default() {
  local prompt="$1"
  local default_value="$2"
  local user_value
  read -r -p "$prompt [$default_value]: " user_value
  if [[ -z "$user_value" ]]; then
    echo "$default_value"
  else
    echo "$user_value"
  fi
}

prompt_required_secret() {
  local prompt="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -s -p "$prompt: " value
    echo
    if [[ -z "$value" ]]; then
      echo "This value is required."
    fi
  done
  echo "$value"
}

prompt_optional_secret() {
  local prompt="$1"
  local value
  read -r -s -p "$prompt (optional, press Enter to skip): " value
  echo
  echo "$value"
}

read_env_file() {
  if [[ -f .env ]]; then
    echo "Found .env file. Loading values as defaults..."
    # Export all non-comment, non-empty lines (strip inline comments too)
    while IFS= read -r line; do
      # Skip empty lines and lines starting with #
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      # Remove inline comments and export
      clean_line=$(echo "$line" | sed 's/#.*$//' | xargs)
      [[ -n "$clean_line" ]] && export "$clean_line"
    done < .env
  fi
}

get_env_value() {
  local key="$1"
  local default="$2"
  # Check if environment variable is set
  if [[ -n "${!key}" ]]; then
    echo "${!key}"
  else
    echo "$default"
  fi
}

acr_name_from_app() {
  local app_name="$1"
  local normalized
  normalized=$(echo "$app_name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
  if [[ ${#normalized} -lt 5 ]]; then
    normalized="${normalized}acr"
  fi
  normalized="${normalized:0:40}"
  echo "${normalized}$RANDOM"
}

get_default_version() {
  # Try to get git commit SHA (short)
  if git rev-parse --short HEAD >/dev/null 2>&1; then
    echo "$(git rev-parse --short HEAD)"
  else
    # Fallback to timestamp
    echo "$(date +%Y%m%d-%H%M%S)"
  fi
}

echo "=== Twilio AI Phone Booth Azure Deployment (Container Apps) ==="

require_cmd az

if ! az account show >/dev/null 2>&1; then
  echo "No active Azure login found. Running 'az login'..."
  az login >/dev/null
fi

AZURE_USER=$(az account show --query user.name -o tsv)
echo "Deploying as: $AZURE_USER"

# Load .env file if it exists
read_env_file

RG=$(prompt_with_default "Resource group name" "rg-ai-summit-london")
APP_NAME=$(prompt_with_default "Container app name" "tac-voice")
LOCATION=$(prompt_with_default "Azure location" "uksouth")
ENV_NAME=$(prompt_with_default "Container Apps environment name" "cae-${APP_NAME}")
ACR=$(prompt_with_default "ACR name (must be globally unique, lowercase alphanumeric)" "$(acr_name_from_app "$APP_NAME")")

# Version management
VERSION=$(prompt_with_default "Version tag (e.g., v1.0.0, git SHA, or 'latest')" "$(get_default_version)")
echo "Deploying version: $VERSION"

echo
if [[ -f .env ]]; then
  echo "Using values from .env file (press Enter to accept, or type new value):"
else
  echo "Enter required Twilio secrets:"
fi

TWILIO_ACCOUNT_SID=$(get_env_value "TWILIO_ACCOUNT_SID" "")
if [[ -z "$TWILIO_ACCOUNT_SID" ]]; then
  TWILIO_ACCOUNT_SID=$(prompt_required_secret "TWILIO_ACCOUNT_SID")
else
  echo "TWILIO_ACCOUNT_SID: [loaded from .env]"
fi

TWILIO_AUTH_TOKEN=$(get_env_value "TWILIO_AUTH_TOKEN" "")
if [[ -z "$TWILIO_AUTH_TOKEN" ]]; then
  TWILIO_AUTH_TOKEN=$(prompt_required_secret "TWILIO_AUTH_TOKEN")
else
  echo "TWILIO_AUTH_TOKEN: [loaded from .env]"
fi

TWILIO_API_KEY=$(get_env_value "TWILIO_API_KEY" "")
if [[ -z "$TWILIO_API_KEY" ]]; then
  TWILIO_API_KEY=$(prompt_required_secret "TWILIO_API_KEY (SK...)")
else
  echo "TWILIO_API_KEY: [loaded from .env]"
fi

TWILIO_API_SECRET=$(get_env_value "TWILIO_API_SECRET" "")
if [[ -z "$TWILIO_API_SECRET" ]]; then
  TWILIO_API_SECRET=$(prompt_required_secret "TWILIO_API_SECRET")
else
  echo "TWILIO_API_SECRET: [loaded from .env]"
fi

TWILIO_PHONE_NUMBER=$(get_env_value "TWILIO_PHONE_NUMBER" "")
if [[ -z "$TWILIO_PHONE_NUMBER" ]]; then
  TWILIO_PHONE_NUMBER=$(prompt_required_secret "TWILIO_PHONE_NUMBER (e.g., +14155551234)")
else
  echo "TWILIO_PHONE_NUMBER: [loaded from .env]"
fi

TWILIO_SYNC_SERVICE_SID=$(get_env_value "TWILIO_SYNC_SERVICE_SID" "")
if [[ -z "$TWILIO_SYNC_SERVICE_SID" ]]; then
  TWILIO_SYNC_SERVICE_SID=$(prompt_required_secret "TWILIO_SYNC_SERVICE_SID (IS...)")
else
  echo "TWILIO_SYNC_SERVICE_SID: [loaded from .env]"
fi

TWILIO_CONVERSATION_CONFIGURATION_ID=$(get_env_value "TWILIO_CONVERSATION_CONFIGURATION_ID" "")
if [[ -z "$TWILIO_CONVERSATION_CONFIGURATION_ID" ]]; then
  TWILIO_CONVERSATION_CONFIGURATION_ID=$(prompt_required_secret "TWILIO_CONVERSATION_CONFIGURATION_ID (conv_configuration_...)")
else
  echo "TWILIO_CONVERSATION_CONFIGURATION_ID: [loaded from .env]"
fi

TWILIO_TAC_CI_CONFIGURATION_ID=$(get_env_value "TWILIO_TAC_CI_CONFIGURATION_ID" "")
if [[ -z "$TWILIO_TAC_CI_CONFIGURATION_ID" ]]; then
  TWILIO_TAC_CI_CONFIGURATION_ID=$(prompt_required_secret "TWILIO_TAC_CI_CONFIGURATION_ID (intelligence_configuration_...)")
else
  echo "TWILIO_TAC_CI_CONFIGURATION_ID: [loaded from .env]"
fi

SIP_PHONE_ADDRESS=$(get_env_value "SIP_PHONE_ADDRESS" "")
if [[ -z "$SIP_PHONE_ADDRESS" ]]; then
  SIP_PHONE_ADDRESS=$(prompt_required_secret "SIP_PHONE_ADDRESS (e.g., +14155551234 or sip:booth@example.com)")
else
  echo "SIP_PHONE_ADDRESS: [loaded from .env]"
fi

echo
OPENAI_API_KEY=$(get_env_value "OPENAI_API_KEY" "")
if [[ -z "$OPENAI_API_KEY" ]]; then
  OPENAI_API_KEY=$(prompt_required_secret "OPENAI_API_KEY")
else
  echo "OPENAI_API_KEY: [loaded from .env]"
fi

echo
STATS_USER=$(get_env_value "STATS_USER" "")
if [[ -z "$STATS_USER" ]]; then
  STATS_USER=$(prompt_required_secret "STATS_USER")
else
  echo "STATS_USER: [loaded from .env]"
fi

STATS_PASS=$(get_env_value "STATS_PASS" "")
if [[ -z "$STATS_PASS" ]]; then
  STATS_PASS=$(prompt_required_secret "STATS_PASS")
else
  echo "STATS_PASS: [loaded from .env]"
fi

echo
ENABLE_MIXOLOGIST=$(prompt_with_default "Enable mixologist integration? (true/false)" "$(get_env_value "ENABLE_MIXOLOGIST" "false")")
if [[ "$ENABLE_MIXOLOGIST" == "true" ]]; then
  MIXOLOGIST_BASE_URL=$(get_env_value "MIXOLOGIST_BASE_URL" "")
  if [[ -z "$MIXOLOGIST_BASE_URL" ]]; then
    MIXOLOGIST_BASE_URL=$(prompt_optional_secret "MIXOLOGIST_BASE_URL")
  else
    echo "MIXOLOGIST_BASE_URL: [loaded from .env]"
  fi

  MIXOLOGIST_AUTH=$(get_env_value "MIXOLOGIST_AUTH" "")
  if [[ -z "$MIXOLOGIST_AUTH" ]]; then
    MIXOLOGIST_AUTH=$(prompt_optional_secret "MIXOLOGIST_AUTH")
  else
    echo "MIXOLOGIST_AUTH: [loaded from .env]"
  fi
else
  MIXOLOGIST_BASE_URL=""
  MIXOLOGIST_AUTH=""
fi
ATTRACT_MODE=$(prompt_with_default "Enable attract mode? (true/false)" "$(get_env_value "ATTRACT_MODE" "false")")

echo
echo "Ensuring Azure Container Apps extension is installed..."
az extension add --name containerapp --upgrade >/dev/null

echo "Creating resource group '$RG' in '$LOCATION'..."
az group create --name "$RG" --location "$LOCATION" --tags created_by="$AZURE_USER" >/dev/null

if ! az acr show --resource-group "$RG" --name "$ACR" >/dev/null 2>&1; then
  echo "Creating Azure Container Registry '$ACR'..."
  az acr create --resource-group "$RG" --name "$ACR" --sku Basic --admin-enabled true --tags created_by="$AZURE_USER" >/dev/null
else
  echo "ACR '$ACR' already exists."
fi

echo "Building image '${APP_NAME}:${VERSION}' in ACR '$ACR'..."
az acr build --registry "$ACR" --image "${APP_NAME}:${VERSION}" --image "${APP_NAME}:latest" .

# Create Log Analytics workspace first (required by policy to have tags)
WORKSPACE_NAME="logs-${APP_NAME}"
if ! az monitor log-analytics workspace show --resource-group "$RG" --workspace-name "$WORKSPACE_NAME" >/dev/null 2>&1; then
  echo "Creating Log Analytics workspace '$WORKSPACE_NAME'..."
  az monitor log-analytics workspace create \
    --resource-group "$RG" \
    --workspace-name "$WORKSPACE_NAME" \
    --location "$LOCATION" \
    --tags created_by="$AZURE_USER" >/dev/null
else
  echo "Log Analytics workspace '$WORKSPACE_NAME' already exists."
fi

# Get workspace ID and key
WORKSPACE_ID=$(az monitor log-analytics workspace show --resource-group "$RG" --workspace-name "$WORKSPACE_NAME" --query customerId -o tsv)
WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys --resource-group "$RG" --workspace-name "$WORKSPACE_NAME" --query primarySharedKey -o tsv)

if ! az containerapp env show --resource-group "$RG" --name "$ENV_NAME" >/dev/null 2>&1; then
  echo "Creating Container Apps environment '$ENV_NAME'..."
  az containerapp env create \
    --resource-group "$RG" \
    --name "$ENV_NAME" \
    --location "$LOCATION" \
    --logs-workspace-id "$WORKSPACE_ID" \
    --logs-workspace-key "$WORKSPACE_KEY" \
    --tags created_by="$AZURE_USER" >/dev/null
else
  echo "Container Apps environment '$ENV_NAME' already exists."
fi

ACR_SERVER="${ACR}.azurecr.io"
ACR_USERNAME=$(az acr credential show --name "$ACR" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR" --query 'passwords[0].value' -o tsv)

if az containerapp show --resource-group "$RG" --name "$APP_NAME" >/dev/null 2>&1; then
  echo "Container app '$APP_NAME' already exists. Updating to version ${VERSION}..."

  # IMPORTANT: Set registry credentials FIRST before updating image
  echo "Setting registry credentials..."
  az containerapp registry set \
    --resource-group "$RG" \
    --name "$APP_NAME" \
    --server "$ACR_SERVER" \
    --username "$ACR_USERNAME" \
    --password "$ACR_PASSWORD" >/dev/null

  echo "Enabling ingress..."
  az containerapp ingress enable \
    --resource-group "$RG" \
    --name "$APP_NAME" \
    --type external \
    --target-port 8000 >/dev/null

  echo "Updating container image to ${VERSION}..."
  az containerapp update \
    --resource-group "$RG" \
    --name "$APP_NAME" \
    --image "${ACR_SERVER}/${APP_NAME}:${VERSION}" \
    --set-env-vars PORT=8000 VERSION="${VERSION}" >/dev/null
else
  echo "Creating container app '$APP_NAME' with version ${VERSION}..."
  az containerapp create \
    --resource-group "$RG" \
    --name "$APP_NAME" \
    --environment "$ENV_NAME" \
    --image "${ACR_SERVER}/${APP_NAME}:${VERSION}" \
    --target-port 8000 \
    --ingress external \
    --registry-server "$ACR_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --env-vars PORT=8000 VERSION="${VERSION}" \
    --tags created_by="$AZURE_USER" version="${VERSION}" >/dev/null
fi

echo "Setting application secrets..."
secret_args=(
  "twilioSid=${TWILIO_ACCOUNT_SID}"
  "twilioToken=${TWILIO_AUTH_TOKEN}"
  "twilioApiKey=${TWILIO_API_KEY}"
  "twilioApiSecret=${TWILIO_API_SECRET}"
  "twilioPhone=${TWILIO_PHONE_NUMBER}"
  "twilioSyncSid=${TWILIO_SYNC_SERVICE_SID}"
  "twilioConvConfigId=${TWILIO_CONVERSATION_CONFIGURATION_ID}"
  "twilioTacCiConfigId=${TWILIO_TAC_CI_CONFIGURATION_ID}"
  "sipPhoneAddress=${SIP_PHONE_ADDRESS}"
  "openai=${OPENAI_API_KEY}"
  "statsUser=${STATS_USER}"
  "statsPass=${STATS_PASS}"
)

if [[ -n "$MIXOLOGIST_BASE_URL" ]]; then
  secret_args+=("mixologistBaseUrl=${MIXOLOGIST_BASE_URL}")
fi

if [[ -n "$MIXOLOGIST_AUTH" ]]; then
  secret_args+=("mixologistAuth=${MIXOLOGIST_AUTH}")
fi

az containerapp secret set \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --secrets "${secret_args[@]}" >/dev/null

FQDN=$(az containerapp show --resource-group "$RG" --name "$APP_NAME" --query properties.configuration.ingress.fqdn -o tsv)

echo "Applying runtime environment variables..."
env_vars=(
  "NGROK_BASE_URL=https://${FQDN}"
  "TWILIO_ACCOUNT_SID=secretref:twilioSid"
  "TWILIO_AUTH_TOKEN=secretref:twilioToken"
  "TWILIO_API_KEY=secretref:twilioApiKey"
  "TWILIO_API_SECRET=secretref:twilioApiSecret"
  "TWILIO_PHONE_NUMBER=secretref:twilioPhone"
  "TWILIO_SYNC_SERVICE_SID=secretref:twilioSyncSid"
  "TWILIO_CONVERSATION_CONFIGURATION_ID=secretref:twilioConvConfigId"
  "TWILIO_TAC_CI_CONFIGURATION_ID=secretref:twilioTacCiConfigId"
  "SIP_PHONE_ADDRESS=secretref:sipPhoneAddress"
  "OPENAI_API_KEY=secretref:openai"
  "STATS_USER=secretref:statsUser"
  "STATS_PASS=secretref:statsPass"
  "ATTRACT_MODE=${ATTRACT_MODE}"
  "ENABLE_MIXOLOGIST=${ENABLE_MIXOLOGIST}"
)

if [[ "$ENABLE_MIXOLOGIST" == "true" ]] && [[ -n "$MIXOLOGIST_BASE_URL" ]]; then
  env_vars+=("MIXOLOGIST_BASE_URL=secretref:mixologistBaseUrl")
fi

if [[ "$ENABLE_MIXOLOGIST" == "true" ]] && [[ -n "$MIXOLOGIST_AUTH" ]]; then
  env_vars+=("MIXOLOGIST_AUTH=secretref:mixologistAuth")
fi

az containerapp update \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --set-env-vars "${env_vars[@]}" >/dev/null

echo "Setting replica scale to 1/1 for in-memory session safety..."
az containerapp update --resource-group "$RG" --name "$APP_NAME" --min-replicas 1 --max-replicas 1 >/dev/null

echo
echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
echo "Version deployed: ${VERSION}"
echo "App URL: https://${FQDN}"
echo "Stats dashboard: https://${FQDN}/stats"
echo "Swag dashboard: https://${FQDN}/swag"
echo "Twilio webhook base URL: https://${FQDN}"
echo
echo "Important webhook endpoints:"
echo "  - TAC webhook (for Twilio Voice): https://${FQDN}/tac"
echo "  - Call status callback: https://${FQDN}/api/callStatus"
echo "  - Conversation Intelligence: https://${FQDN}/intelligence-results"
echo
echo "Quick checks:"
echo "  curl -i https://${FQDN}/"
echo "  curl -u ${STATS_USER} https://${FQDN}/stats"
