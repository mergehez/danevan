Dim conn
Set conn = CreateObject("ADODB.Connection")
Dim dbPath
dbPath = WScript.Arguments(0)
On Error Resume Next
conn.Open "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=" & dbPath & ";Persist Security Info=False;"
If Err.Number <> 0 Then
    WScript.Echo "Error: " & Err.Description & " (Code: " & Err.Number & ")"
    WScript.Quit 1
End If
WScript.Echo "SUCCESS: ADODB Connection to ACE 16.0 established natively!"
conn.Close
