# OmniExporter AI — Pre-PR Verification Script
# Run: pwsh scripts\verify.ps1
# Exits with code 1 if any check fails.
# ============================================================
$ErrorActionPreference = "Continue"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$totalFail = 0

function Pass($msg) { Write-Host "  PASS  $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red; $script:totalFail++ }
function Section($title) { Write-Host "`n=== $title ===" -ForegroundColor Cyan }

# ─── LAYER 1: Syntax ───────────────────────────────────────
Section "LAYER 1 — Syntax Check (node --check)"
$jsDirs = @("src","auth")
Get-ChildItem -Recurse -Filter "*.js" -Path $jsDirs | ForEach-Object {
    $r = node --check $_.FullName 2>&1
    if ($LASTEXITCODE -ne 0) { Fail $_.Name; Write-Host "  $r" } else { Pass $_.Name }
}

# ─── LAYER 2: Manifest ─────────────────────────────────────
Section "LAYER 2 — Manifest Integrity"
$m = Get-Content "manifest.json" | ConvertFrom-Json

# Files exist
$m.content_scripts | ForEach-Object { $_.js } | ForEach-Object {
    if (!(Test-Path $_)) { Fail "File missing: $_" } else { Pass "exists: $_" }
}

# Permissions
@("storage","unlimitedStorage","alarms","tabs","contextMenus","scripting","activeTab","identity") | ForEach-Object {
    if ($_ -notin $m.permissions) { Fail "Permission missing: $_" } else { Pass "perm: $_" }
}

# web_accessible_resources
$m.web_accessible_resources | ForEach-Object { $_.resources } | ForEach-Object {
    if ($_ -notmatch "\*") {
        if (!(Test-Path $_)) { Fail "WAR missing: $_" } else { Pass "WAR: $_" }
    }
}

# ─── LAYER 3: Fix Regression Guard ─────────────────────────
Section "LAYER 3 — Fix Regression Guard"
$bg = Get-Content "src\background.js" -Raw
$ct = Get-Content "src\content.js" -Raw
$ga = Get-Content "src\adapters\gemini-adapter.js" -Raw
$em = Get-Content "src\utils\export-manager.js" -Raw
$mf = Get-Content "manifest.json" -Raw

# Alarm
if ($bg -match "periodInMinutes: 0\.4") { Fail "REGRESSION: alarm still 0.4 min (should be 1)" }
else { Pass "Alarm interval: not 0.4 min" }
if (-not ($bg -match "createKeepAliveAlarm")) { Fail "MISSING: createKeepAliveAlarm guard" }
else { Pass "createKeepAliveAlarm guard present" }

# Notion pagination
if ($bg -match 'children\.slice\(0,\s*100\)[^;]*\)') { Fail "REGRESSION: Notion children hardcoded to 100 (old truncation)" }
else { Pass "Notion block pagination: no hardcoded slice" }
if (-not ($bg -match 'notionFetchWithBackoff')) { Fail "MISSING: notionFetchWithBackoff" }
else { Pass "notionFetchWithBackoff present" }

# Sync lock
if (-not ($bg -match 'syncStartTime')) { Fail "MISSING: sync lock stale detection" }
else { Pass "Sync lock cross-restart check present" }

# REAL-4: trackFailure
if (-not ($bg -match 'syncFailures\[failure')) { Fail "MISSING: trackFailure writes syncFailures[uuid]" }
else { Pass "trackFailure writes syncFailures map" }

# REAL-5: answer extraction
if ($bg -match "intended_usage === 'ask_text'") { Fail "REGRESSION: intended_usage filter in syncToNotion" }
else { Pass "Answer extraction: no intended_usage filter" }

# REAL-6: context menu
if (-not ($ct -match 'EXPORT_THREAD')) { Fail "MISSING: EXPORT_THREAD handler in content.js" }
else { Pass "EXPORT_THREAD handler present" }

# REAL-7: Perplexity version
if ($ct -match '"x-app-apiversion": "2\.18"') { Fail "REGRESSION: Perplexity version still hardcoded 2.18" }
else { Pass "Perplexity version: not hardcoded" }

# REAL-8: first request delay
if ($ct -match 'if \(offset > 0\)\s*\{') { Fail "REGRESSION: first-request anti-bot delay still guarded by offset>0" }
else { Pass "Anti-bot delay: applied to all requests" }

# REAL-9: GeminiBridge
if (-not ($ga -match '_listenerAdded')) { Fail "MISSING: GeminiBridge._listenerAdded dedup guard" }
else { Pass "GeminiBridge._listenerAdded guard present" }

# REAL-10: batch cap
if ($bg -match 'Math\.min\(newThreads\.length,\s*10\)') { Fail "REGRESSION: 10-thread batch cap still present" }
else { Pass "No 10-thread batch cap" }

# REAL-11: recordSyncJob
if (-not ($bg -match 'attempted = total')) { Fail "MISSING: recordSyncJob 4th param 'attempted'" }
else { Pass "recordSyncJob: attempted param present" }

# REAL-14: ExportManager SPA guard
if (-not ($em -match 'window\.ExportManager')) { Fail "MISSING: ExportManager window guard" }
else { Pass "ExportManager: window guard present" }

# Storage quota
if (-not ($mf -match 'unlimitedStorage')) { Fail "MISSING: unlimitedStorage in manifest" }
else { Pass "unlimitedStorage permission present" }

# content-type guard
if (-not ($bg -match 'content-type')) { Fail "MISSING: content-type check before .json()" }
else { Pass "Content-type guard before .json()" }

# ─── LAYER 4: Storage Keys ─────────────────────────────────
Section "LAYER 4 — Storage Key Consistency"
$allJs = Get-ChildItem -Recurse -Filter "*.js" -Path "src","auth" | ForEach-Object { Get-Content $_.FullName -Raw }
$combined = $allJs -join "`n"

@("syncFailures","failures","exportedUuids","syncInProgress","exportHistory","exportedUuids") | Select-Object -Unique | ForEach-Object {
    $key = $_
    $writes = ($combined | Select-String "\.set\(\s*\{[^}]*$key" -AllMatches).Matches.Count
    $reads  = ($combined | Select-String "\.get\([^)]*'$key'" -AllMatches).Matches.Count +
              ($combined | Select-String "\.get\(\s*\['[^']*$key" -AllMatches).Matches.Count
    if ($writes -gt 0 -and $reads -gt 0) { Pass "Storage key: $key (written+read)" }
    elseif ($writes -gt 0) { Write-Host "  WARN  Storage key '$key' written but not read (check if read via destructuring)" -ForegroundColor Yellow }
    elseif ($reads -gt 0) { Write-Host "  WARN  Storage key '$key' read but not written (may be written by UI)" -ForegroundColor Yellow }
}

# ─── LAYER 5: Message Routing ──────────────────────────────
Section "LAYER 5 — Message Routing Completeness"
$sentTypes = [System.Collections.Generic.List[string]]::new()
[regex]::Matches($bg, "type: '([A-Z_]+)'") | ForEach-Object { $sentTypes.Add($_.Groups[1].Value) }
$handledTypes = [System.Collections.Generic.List[string]]::new()
[regex]::Matches($ct, 'request\.type === "([A-Z_]+)"') | ForEach-Object { $handledTypes.Add($_.Groups[1].Value) }

foreach ($t in ($sentTypes | Sort-Object -Unique)) {
    if ($t -in $handledTypes) { Pass "Message routed: $t" }
    else { Fail "UNHANDLED MESSAGE TYPE: $t (sent by background, no handler in content.js)" }
}

# ─── Summary ────────────────────────────────────────────────
Write-Host "`n" + ("=" * 55)
if ($totalFail -eq 0) {
    Write-Host "✅  ALL LAYERS PASSED — safe to open PR" -ForegroundColor Green
} else {
    Write-Host "❌  $totalFail CHECK(S) FAILED — fix before opening PR" -ForegroundColor Red
    exit 1
}
