# Test Access OLEDB providers — run this directly in PowerShell ISE

$testDbPath = "C:\Users\mergewin\Desktop\test-access-db.mdb"

Write-Host "=== Installed OLEDB providers ===" -ForegroundColor Cyan
(New-Object system.data.oledb.oledbenumerator).GetElements() | Select-Object SOURCES_NAME

Write-Host "`n=== Testing each Access provider with a temp DB ===" -ForegroundColor Cyan

$candidates = @("Microsoft.ACE.OLEDB.16.0", "Microsoft.ACE.OLEDB.12.0", "Microsoft.Jet.OLEDB.4.0")
$found = $false

foreach ($candidate in $candidates) {
    try {
        $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=$candidate;Data Source=$testDbPath;Persist Security Info=False;")
        $conn.Open()
        Write-Host "  [$candidate] CONNECTED OK" -ForegroundColor Green
        $conn.Close()
        $conn.Dispose()
        $found = $true

        # Also test creating a table and querying it
        $conn2 = New-Object System.Data.OleDb.OleDbConnection("Provider=$candidate;Data Source=$testDbPath;Persist Security Info=False;")
        $conn2.Open()
        $cmd = $conn2.CreateCommand()
        $cmd.CommandText = "CREATE TABLE [test] ([id] INTEGER, [name] TEXT)"
        $cmd.ExecuteNonQuery() | Out-Null
        $cmd.CommandText = "INSERT INTO [test] VALUES (1, 'hello')"
        $cmd.ExecuteNonQuery() | Out-Null
        $cmd.CommandText = "SELECT * FROM [test]"
        $reader = $cmd.ExecuteReader()
        while ($reader.Read()) {
            Write-Host "    Row: id=$($reader['id']), name=$($reader['name'])" -ForegroundColor Yellow
        }
        $reader.Close()
        $cmd.CommandText = "DROP TABLE [test]"
        $cmd.ExecuteNonQuery() | Out-Null
        $conn2.Close()
        $conn2.Dispose()
        Write-Host "  [$candidate] Read/Write test PASSED" -ForegroundColor Green
    } catch {
        Write-Host "  [$candidate] FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Cleanup
if (Test-Path $testDbPath) { Remove-Item $testDbPath -Force }

if (-not $found) {
    Write-Host "`nNo working Access OLEDB provider found." -ForegroundColor Red
    Write-Host "Download from: https://www.microsoft.com/en-us/download/details.aspx?id=54920" -ForegroundColor Yellow
    Write-Host "Make sure to install the SAME bitness as PowerShell (run '[Environment]::Is64BitProcess' to check)." -ForegroundColor Yellow
} else {
    Write-Host "`nAt least one provider works!" -ForegroundColor Green
}
