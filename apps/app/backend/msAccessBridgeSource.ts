export const MS_ACCESS_BRIDGE_SOURCE = String.raw`
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import io.github.spannm.jackcess.Column;
import io.github.spannm.jackcess.Database;
import io.github.spannm.jackcess.DatabaseBuilder;
import io.github.spannm.jackcess.Table;

public class MsAccessBridge {
    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            throw new IllegalArgumentException("Expected <operation>.");
        }

        if ("serve".equals(args[0])) {
            requireArgCount(args, 2, "serve requires a database path.");
            runServer(args[1]);
            return;
        }

        requireArgCount(args, 2, "Expected <operation> <databasePath>.");
        System.out.print(toJson(executeSingleOperation(args[0], args[1], sliceArgs(args, 2))));
    }

    private static void requireArgCount(String[] args, int minimum, String message) {
        if (args.length < minimum) {
            throw new IllegalArgumentException(message);
        }
    }

    private static Object executeSingleOperation(String operation, String databasePath, String[] operationArgs) throws Exception {
        if ("test".equals(operation)) {
            return testConnection(databasePath);
        }

        Class.forName("net.ucanaccess.jdbc.UcanaccessDriver");

        try (Connection connection = DriverManager.getConnection("jdbc:ucanaccess://" + databasePath)) {
            return executeOperation(connection, databasePath, operation, operationArgs);
        }
    }

    private static void runServer(String databasePath) throws Exception {
        Class.forName("net.ucanaccess.jdbc.UcanaccessDriver");

        try (
            BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8))
        ) {
            String line;

            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    continue;
                }

                boolean shouldDisconnect = false;

                try {
                    String[] requestArgs = decodeWorkerRequest(line);
                    requireArgCount(requestArgs, 1, "Worker request is empty.");
                    String operation = requestArgs[0];

                    if ("disconnect".equals(operation)) {
                        Map<String, Object> result = new LinkedHashMap<>();
                        result.put("disconnected", Boolean.TRUE);
                        writer.write(workerSuccessJson(result));
                        shouldDisconnect = true;
                    } else {
                        try (Connection connection = DriverManager.getConnection("jdbc:ucanaccess://" + databasePath)) {
                            writer.write(workerSuccessJson(executeOperation(connection, databasePath, operation, sliceArgs(requestArgs, 1))));
                        }
                    }
                } catch (Exception error) {
                    writer.write(workerErrorJson(error));
                }

                writer.newLine();
                writer.flush();

                if (shouldDisconnect) {
                    return;
                }
            }
        }
    }

    private static Object executeOperation(Connection connection, String databasePath, String operation, String[] args) throws Exception {
        switch (operation) {
            case "test":
                return testConnection(databasePath);
            case "listTables":
                return listTables(connection);
            case "getTableInfo":
                requireArgCount(args, 1, "getTableInfo requires a table name.");
                return getTableInfo(connection, databasePath, args[0]);
            case "getReferencingForeignKeys":
                requireArgCount(args, 1, "getReferencingForeignKeys requires a table name.");
                return getReferencingForeignKeys(connection, args[0]);
            case "getTableData":
                requireArgCount(args, 3, "getTableData requires table name, limit, and offset.");
                return getTableData(connection, args[0], Integer.parseInt(args[1]), Integer.parseInt(args[2]), args.length > 4 ? args[3] : null, args.length > 4 ? args[4] : null);
            case "runQuery":
                requireArgCount(args, 1, "runQuery requires SQL.");
                return runQuery(connection, decodeBase64Utf8(args[0]), decodeParams(args, 1));
            case "executeStatements":
                requireArgCount(args, 1, "executeStatements requires at least one SQL statement.");
                return executeStatements(connection, args);
            case "applyChanges":
                requireArgCount(args, 5, "applyChanges requires table name, limit, offset, disable flag, and change count.");
                return applyChanges(connection, args[0], Integer.parseInt(args[1]), Integer.parseInt(args[2]), Boolean.parseBoolean(args[3]), Integer.parseInt(args[4]), args, 5);
            default:
                throw new IllegalArgumentException("Unsupported MS Access bridge operation: " + operation);
        }
    }

    private static String[] sliceArgs(String[] args, int startIndex) {
        int length = Math.max(0, args.length - startIndex);
        String[] sliced = new String[length];

        for (int index = 0; index < length; index += 1) {
            sliced[index] = args[startIndex + index];
        }

        return sliced;
    }

    private static String[] decodeWorkerRequest(String encodedLine) {
        String[] parts = encodedLine.split("\\t", -1);
        String[] decoded = new String[parts.length];

        for (int index = 0; index < parts.length; index += 1) {
            decoded[index] = decodeBase64Utf8(parts[index]);
        }

        return decoded;
    }

    private static String workerSuccessJson(Object result) {
        return "{\"ok\":true,\"result\":" + toJson(result) + "}";
    }

    private static String workerErrorJson(Exception error) {
        return "{\"ok\":false,\"error\":" + quoteJson(error.getMessage() != null ? error.getMessage() : String.valueOf(error)) + "}";
    }

    private static Map<String, Object> testConnection(String databasePath) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("ok", Boolean.TRUE);
        response.put("message", "Connected to MS Access file " + databasePath + ".");
        return response;
    }

    private static List<Map<String, Object>> listTables(Connection connection) throws Exception {
        DatabaseMetaData metadata = connection.getMetaData();
        List<Map<String, Object>> tables = new ArrayList<>();

        try (ResultSet resultSet = metadata.getTables(null, null, "%", new String[] { "TABLE", "VIEW" })) {
            while (resultSet.next()) {
                String tableName = resultSet.getString("TABLE_NAME");

                if (tableName == null || tableName.startsWith("MSys")) {
                    continue;
                }

                String tableType = resultSet.getString("TABLE_TYPE");
                Map<String, Object> table = new LinkedHashMap<>();
                table.put("name", tableName);
                table.put("type", "VIEW".equalsIgnoreCase(tableType) ? "view" : "table");
                table.put("rowCount", "VIEW".equalsIgnoreCase(tableType) ? Integer.valueOf(0) : Integer.valueOf(queryRowCount(connection, tableName)));
                tables.add(table);
            }
        }

        return tables;
    }

    private static Map<String, Object> getTableInfo(Connection connection, String databasePath, String tableName) throws Exception {
        DatabaseMetaData metadata = connection.getMetaData();
        Map<String, Integer> primaryKeyOrdinals = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, Boolean> autoIncrementByColumn = readAutoIncrementByColumn(databasePath, tableName);
        Map<String, String> liveTypeNameByColumn = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);

        try (ResultSet primaryKeys = metadata.getPrimaryKeys(null, null, tableName)) {
            while (primaryKeys.next()) {
                primaryKeyOrdinals.put(primaryKeys.getString("COLUMN_NAME"), Integer.valueOf(primaryKeys.getShort("KEY_SEQ")));
            }
        }

        try (Statement statement = connection.createStatement(); ResultSet resultSet = statement.executeQuery("SELECT * FROM " + quoteIdentifier(tableName) + " WHERE 1 = 0")) {
            ResultSetMetaData resultSetMetaData = resultSet.getMetaData();

            for (int columnIndex = 1; columnIndex <= resultSetMetaData.getColumnCount(); columnIndex += 1) {
                String columnLabel = resultSetMetaData.getColumnLabel(columnIndex);
                String liveTypeName = resultSetMetaData.getColumnTypeName(columnIndex);
                boolean isAutoIncrement = resultSetMetaData.isAutoIncrement(columnIndex) || isAutoIncrementTypeName(liveTypeName);

                autoIncrementByColumn.put(columnLabel, Boolean.valueOf(isAutoIncrement));
                if (liveTypeName != null) {
                    liveTypeNameByColumn.put(columnLabel, liveTypeName);
                }
            }
        }

        List<Map<String, Object>> columns = new ArrayList<>();

        try (ResultSet resultSet = metadata.getColumns(null, null, tableName, "%")) {
            while (resultSet.next()) {
                String columnName = resultSet.getString("COLUMN_NAME");
                int primaryKeyOrdinal = primaryKeyOrdinals.getOrDefault(columnName, Integer.valueOf(0)).intValue();
                String liveTypeName = liveTypeNameByColumn.get(columnName);
                String metadataTypeName = resultSet.getString("TYPE_NAME");
                String formattedType = formatType(resultSet);
                boolean isAutoIncrement = Boolean.TRUE.equals(autoIncrementByColumn.get(columnName))
                    || isAutoIncrementTypeName(liveTypeName)
                    || isLikelyAccessAutoIncrementColumn(columnName, primaryKeyOrdinal, metadataTypeName, liveTypeName, formattedType)
                    || "YES".equalsIgnoreCase(resultSet.getString("IS_AUTOINCREMENT"));
                Map<String, Object> column = new LinkedHashMap<>();
                column.put("cid", Integer.valueOf(Math.max(0, resultSet.getInt("ORDINAL_POSITION") - 1)));
                column.put("name", columnName);
                column.put("type", isAutoIncrement ? "AUTOINCREMENT" : formattedType);
                column.put("notNull", Boolean.valueOf(resultSet.getInt("NULLABLE") == DatabaseMetaData.columnNoNulls));
                column.put("defaultValue", resultSet.getString("COLUMN_DEF"));
                column.put("isPrimaryKey", Boolean.valueOf(primaryKeyOrdinal > 0));
                column.put("primaryKeyOrdinal", primaryKeyOrdinal > 0 ? Integer.valueOf(primaryKeyOrdinal) : null);
                column.put("isAutoIncrement", Boolean.valueOf(isAutoIncrement));
                column.put("comment", null);
                column.put("collation", null);
                column.put("onUpdate", null);
                columns.add(column);
            }
        }

        Map<String, Map<String, Object>> indexesByName = new LinkedHashMap<>();

        try (ResultSet resultSet = metadata.getIndexInfo(null, null, tableName, false, false)) {
            while (resultSet.next()) {
                short indexType = resultSet.getShort("TYPE");
                String indexName = resultSet.getString("INDEX_NAME");
                String columnName = resultSet.getString("COLUMN_NAME");

                if (indexType == DatabaseMetaData.tableIndexStatistic || indexName == null || columnName == null) {
                    continue;
                }

                Map<String, Object> index = indexesByName.get(indexName);
                if (index == null) {
                    index = new LinkedHashMap<>();
                    index.put("name", indexName);
                    index.put("columns", new ArrayList<String>());
                    index.put("isUnique", Boolean.valueOf(!resultSet.getBoolean("NON_UNIQUE")));
                    index.put("origin", "index");
                    index.put("isPartial", Boolean.FALSE);
                    indexesByName.put(indexName, index);
                }

                @SuppressWarnings("unchecked")
                List<String> indexColumns = (List<String>) index.get("columns");
                indexColumns.add(columnName);
            }
        }

        List<Map<String, Object>> foreignKeys = new ArrayList<>();
        Map<String, Integer> foreignKeyIds = new LinkedHashMap<>();
        int foreignKeyCounter = 0;

        try (ResultSet resultSet = metadata.getImportedKeys(null, null, tableName)) {
            while (resultSet.next()) {
                String keyName = resultSet.getString("FK_NAME");
                if (keyName == null || keyName.isEmpty()) {
                    keyName = resultSet.getString("PKTABLE_NAME") + ":" + resultSet.getString("FKCOLUMN_NAME");
                }

                Integer foreignKeyId = foreignKeyIds.get(keyName);
                if (foreignKeyId == null) {
                    foreignKeyId = Integer.valueOf(foreignKeyCounter);
                    foreignKeyIds.put(keyName, foreignKeyId);
                    foreignKeyCounter += 1;
                }

                Map<String, Object> foreignKey = new LinkedHashMap<>();
                foreignKey.put("id", foreignKeyId);
                foreignKey.put("name", keyName);
                foreignKey.put("sequence", Integer.valueOf(Math.max(0, resultSet.getShort("KEY_SEQ") - 1)));
                foreignKey.put("table", resultSet.getString("PKTABLE_NAME"));
                foreignKey.put("from", resultSet.getString("FKCOLUMN_NAME"));
                foreignKey.put("to", resultSet.getString("PKCOLUMN_NAME"));
                foreignKey.put("onUpdate", mapForeignKeyRule(resultSet.getShort("UPDATE_RULE")));
                foreignKey.put("onDelete", mapForeignKeyRule(resultSet.getShort("DELETE_RULE")));
                foreignKey.put("match", "NONE");
                foreignKeys.add(foreignKey);
            }
        }

        Map<String, Object> tableInfo = new LinkedHashMap<>();
        tableInfo.put("name", tableName);
        tableInfo.put("columns", columns);
        tableInfo.put("indexes", new ArrayList<>(indexesByName.values()));
        tableInfo.put("foreignKeys", foreignKeys);
        tableInfo.put("rowCount", Integer.valueOf(queryRowCount(connection, tableName)));
        return tableInfo;
    }

    private static List<Map<String, Object>> getReferencingForeignKeys(Connection connection, String tableName) throws Exception {
        DatabaseMetaData metadata = connection.getMetaData();
        List<Map<String, Object>> foreignKeys = new ArrayList<>();

        try (ResultSet resultSet = metadata.getExportedKeys(null, null, tableName)) {
            while (resultSet.next()) {
                Map<String, Object> foreignKey = new LinkedHashMap<>();
                foreignKey.put("name", resultSet.getString("FK_NAME"));
                foreignKey.put("table", resultSet.getString("FKTABLE_NAME"));
                foreignKey.put("from", resultSet.getString("FKCOLUMN_NAME"));
                foreignKey.put("to", resultSet.getString("PKCOLUMN_NAME"));
                foreignKeys.add(foreignKey);
            }
        }

        return foreignKeys;
    }

    private static boolean isAutoIncrementTypeName(String typeName) {
        if (typeName == null) {
            return false;
        }

        String normalized = typeName.toUpperCase(Locale.ROOT);
        return normalized.contains("COUNTER") || normalized.contains("AUTOINCREMENT") || normalized.contains("IDENTITY");
    }

    private static boolean isLikelyAccessAutoIncrementColumn(String columnName, int primaryKeyOrdinal, String metadataTypeName, String liveTypeName, String formattedType) {
        if (columnName == null || primaryKeyOrdinal != 1 || !"id".equalsIgnoreCase(columnName.trim())) {
            return false;
        }

        return isIntegerLikeTypeName(metadataTypeName) || isIntegerLikeTypeName(liveTypeName) || isIntegerLikeTypeName(formattedType);
    }

    private static boolean isIntegerLikeTypeName(String typeName) {
        if (typeName == null) {
            return false;
        }

        String normalized = typeName.toUpperCase(Locale.ROOT).trim();
        return normalized.contains("INT") || normalized.contains("LONG") || normalized.contains("SHORT") || normalized.contains("COUNTER") || normalized.contains("AUTOINCREMENT");
    }

    private static Map<String, Boolean> readAutoIncrementByColumn(String databasePath, String tableName) throws Exception {
        Map<String, Boolean> result = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);

        try (Database database = new DatabaseBuilder(Path.of(databasePath)).withReadOnly(true).open()) {
            Table table = database.getTable(tableName);

            if (table == null) {
                return result;
            }

            for (Column column : table.getColumns()) {
                result.put(column.getName(), Boolean.valueOf(column.isAutoNumber()));
            }
        }

        return result;
    }

    private static Map<String, Object> getTableData(Connection connection, String tableName, int limit, int offset, String orderByColumn, String orderByDirection) throws Exception {
        long startedAt = System.nanoTime();
        String sql = buildTableDataSql(tableName, limit, offset, orderByColumn, orderByDirection);
        boolean unlimited = limit < 0;

        try (Statement statement = connection.createStatement()) {
            statement.setMaxRows(getMaxRowsForTableData(limit, offset));
            statement.setFetchSize(unlimited ? 500 : Math.max(1, Math.min(limit, 500)));

            try (ResultSet resultSet = statement.executeQuery(sql)) {
                ResultSetMetaData metadata = resultSet.getMetaData();
                int columnCount = metadata.getColumnCount();
                List<String> columns = getResultColumns(metadata);
                String[] quotedColumnLabels = getQuotedColumnLabels(metadata, columnCount);
                int[] columnTypes = getColumnTypes(metadata, columnCount);
                long afterQueryAt = System.nanoTime();

                for (int skipped = 0; skipped < offset && resultSet.next(); skipped += 1) {
                    // skip rows until offset is reached
                }

                long afterOffsetAt = System.nanoTime();

                int collected = 0;
                Path tempFile = Files.createTempFile("danevan-msaccess-tabledata-", ".json");

                try (BufferedWriter writer = Files.newBufferedWriter(tempFile, StandardCharsets.UTF_8)) {
                    writer.write('{');
                    writer.write("\"columns\":");
                    writeStringArray(writer, columns);
                    writer.write(",\"rows\":[");

                    boolean firstRow = true;

                    while ((unlimited || collected < limit) && resultSet.next()) {
                        if (!firstRow) {
                            writer.write(',');
                        }

                        firstRow = false;
                        writer.write('{');

                        for (int columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                            if (columnIndex > 0) {
                                writer.write(',');
                            }

                            int resultSetColumnIndex = columnIndex + 1;
                            writer.write(quotedColumnLabels[columnIndex]);
                            writer.write(':');
                            writeResultCellJson(writer, resultSet, resultSetColumnIndex, columnTypes[columnIndex]);
                        }

                        writer.write('}');
                        collected += 1;
                    }

                    writer.write(']');

                    long afterRowsAt = System.nanoTime();
                    int rowCount = queryRowCount(connection, tableName);
                    long afterCountAt = System.nanoTime();

                    writer.write(",\"rowCount\":");
                    writer.write(Integer.toString(rowCount));
                    writer.write(",\"perf\":");
                    writer.write(
                        toJson(
                            perfMap(
                                startedAt,
                                afterQueryAt,
                                afterOffsetAt,
                                afterRowsAt,
                                afterCountAt,
                                offset,
                                collected,
                                limit,
                                tableName,
                                sql,
                                rowCount
                            )
                        )
                    );
                    writer.write('}');
                }

                Map<String, Object> response = new LinkedHashMap<>();
                response.put("transport", "file");
                response.put("filePath", tempFile.toString());
                response.put("rowCount", Integer.valueOf(collected));
                return response;
            }
        }
    }

    private static Map<String, Object> runQuery(Connection connection, String sql, List<Object> params) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            bindParams(statement, params);
            boolean hasResultSet = statement.execute();

            if (hasResultSet) {
                try (ResultSet resultSet = statement.getResultSet()) {
                    ResultSetMetaData metadata = resultSet.getMetaData();
                    int columnCount = metadata.getColumnCount();
                    List<String> columns = getResultColumns(metadata);
                    String[] quotedColumnLabels = getQuotedColumnLabels(metadata, columnCount);
                    int[] columnTypes = getColumnTypes(metadata, columnCount);
                    Path tempFile = Files.createTempFile("danevan-msaccess-query-", ".json");

                    try (BufferedWriter writer = Files.newBufferedWriter(tempFile, StandardCharsets.UTF_8)) {
                        writer.write('{');
                        writer.write("\"kind\":\"rows\",\"columns\":");
                        writeStringArray(writer, columns);
                        writer.write(",\"rows\":[");
                        writeResultRowsJson(writer, resultSet, quotedColumnLabels, columnTypes, Integer.MAX_VALUE);
                        writer.write("]}");
                    }

                    Map<String, Object> response = new LinkedHashMap<>();
                    response.put("kind", "rows");
                    response.put("transport", "file");
                    response.put("filePath", tempFile.toString());
                    return response;
                }
            }

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("kind", "mutation");
            response.put("lastInsertRowid", Long.valueOf(getGeneratedKey(statement, statement.getUpdateCount())));
            return response;
        }
    }

    private static Map<String, Object> executeStatements(Connection connection, String[] statements) throws Exception {
        boolean originalAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);

        int executedCount = 0;

        try {
            for (String sql : statements) {
                if (sql == null || sql.trim().isEmpty()) {
                    continue;
                }

                try (Statement statement = connection.createStatement()) {
                    statement.execute(sql);
                    executedCount += 1;
                }
            }

            connection.commit();
        } catch (Exception error) {
            connection.rollback();
            throw error;
        } finally {
            connection.setAutoCommit(originalAutoCommit);
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("executedCount", Integer.valueOf(executedCount));
        return response;
    }

    private static Map<String, Object> applyChanges(Connection connection, String tableName, int limit, int offset, boolean disableForeignKeys, int changeCount, String[] args,
        int changeOffset) throws Exception {
        if (disableForeignKeys) {
            throw new IllegalArgumentException("Disabling foreign key checks is not supported for MS Access.");
        }

        boolean originalAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);

        try {
            for (int index = 0; index < changeCount; index += 1) {
                int baseIndex = changeOffset + (index * 4);
                if (args.length <= baseIndex + 3) {
                    throw new IllegalArgumentException("Incomplete applyChanges payload.");
                }

                String targetColumn = args[baseIndex];
                Object targetValue = decodeValue(args[baseIndex + 1]);
                String matchColumn = args[baseIndex + 2];
                Object matchValue = decodeValue(args[baseIndex + 3]);
                String sql = "UPDATE " + quoteIdentifier(tableName) + " SET " + quoteIdentifier(targetColumn) + " = ? WHERE " + quoteIdentifier(matchColumn) + " = ?";

                try (PreparedStatement statement = connection.prepareStatement(sql)) {
                    bindValue(statement, 1, targetValue);
                    bindValue(statement, 2, matchValue);
                    statement.executeUpdate();
                }
            }

            connection.commit();
        } catch (Exception error) {
            connection.rollback();
            throw error;
        } finally {
            connection.setAutoCommit(originalAutoCommit);
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("tableData", getTableData(connection, tableName, limit, offset, null, null));
        response.put("foreignKeyViolations", new ArrayList<String>());
        return response;
    }

    private static List<String> getResultColumns(ResultSetMetaData metadata) throws Exception {
        List<String> columns = new ArrayList<>();

        for (int columnIndex = 1; columnIndex <= metadata.getColumnCount(); columnIndex += 1) {
            columns.add(metadata.getColumnLabel(columnIndex));
        }

        return columns;
    }

    private static String[] getQuotedColumnLabels(ResultSetMetaData metadata, int columnCount) throws Exception {
        String[] labels = new String[columnCount];

        for (int columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            labels[columnIndex] = quoteJson(metadata.getColumnLabel(columnIndex + 1));
        }

        return labels;
    }

    private static int[] getColumnTypes(ResultSetMetaData metadata, int columnCount) throws Exception {
        int[] columnTypes = new int[columnCount];

        for (int columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            columnTypes[columnIndex] = metadata.getColumnType(columnIndex + 1);
        }

        return columnTypes;
    }

    private static int writeResultRowsJson(BufferedWriter writer, ResultSet resultSet, String[] quotedColumnLabels, int[] columnTypes, int limit) throws Exception {
        int collected = 0;
        int columnCount = quotedColumnLabels.length;
        boolean firstRow = true;

        while (collected < limit && resultSet.next()) {
            if (!firstRow) {
                writer.write(',');
            }

            firstRow = false;
            writer.write('{');

            for (int columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                if (columnIndex > 0) {
                    writer.write(',');
                }

                int resultSetColumnIndex = columnIndex + 1;
                writer.write(quotedColumnLabels[columnIndex]);
                writer.write(':');
                writeResultCellJson(writer, resultSet, resultSetColumnIndex, columnTypes[columnIndex]);
            }

            writer.write('}');
            collected += 1;
        }

        return collected;
    }

    private static void writeResultCellJson(BufferedWriter writer, ResultSet resultSet, int columnIndex, int columnType) throws Exception {
        switch (columnType) {
            case Types.BIT:
            case Types.BOOLEAN: {
                boolean value = resultSet.getBoolean(columnIndex);
                writer.write(resultSet.wasNull() ? "null" : (value ? "1" : "0"));
                return;
            }
            case Types.TINYINT:
            case Types.SMALLINT:
            case Types.INTEGER:
            case Types.BIGINT: {
                long value = resultSet.getLong(columnIndex);
                writer.write(resultSet.wasNull() ? "null" : Long.toString(value));
                return;
            }
            case Types.FLOAT:
            case Types.REAL:
            case Types.DOUBLE: {
                double value = resultSet.getDouble(columnIndex);
                writer.write(resultSet.wasNull() ? "null" : Double.toString(value));
                return;
            }
            case Types.NUMERIC:
            case Types.DECIMAL: {
                BigDecimal value = resultSet.getBigDecimal(columnIndex);
                writer.write(value == null ? "null" : quoteJson(value.stripTrailingZeros().toPlainString()));
                return;
            }
            case Types.TIMESTAMP:
            case Types.TIMESTAMP_WITH_TIMEZONE: {
                Timestamp value = resultSet.getTimestamp(columnIndex);
                writer.write(value == null ? "null" : quoteJson(value.toInstant().atOffset(ZoneOffset.UTC).toString()));
                return;
            }
            case Types.DATE: {
                java.sql.Date value = resultSet.getDate(columnIndex);
                writer.write(value == null ? "null" : quoteJson(value.toString()));
                return;
            }
            case Types.TIME:
            case Types.TIME_WITH_TIMEZONE: {
                java.sql.Time value = resultSet.getTime(columnIndex);
                writer.write(value == null ? "null" : quoteJson(value.toString()));
                return;
            }
            case Types.BINARY:
            case Types.VARBINARY:
            case Types.LONGVARBINARY:
            case Types.BLOB: {
                byte[] value = resultSet.getBytes(columnIndex);
                writer.write(value == null ? "null" : quoteJson(Base64.getEncoder().encodeToString(value)));
                return;
            }
            case Types.CHAR:
            case Types.VARCHAR:
            case Types.LONGVARCHAR:
            case Types.NCHAR:
            case Types.NVARCHAR:
            case Types.LONGNVARCHAR:
            case Types.CLOB:
            case Types.NCLOB: {
                String value = resultSet.getString(columnIndex);
                writer.write(value == null ? "null" : quoteJson(value));
                return;
            }
            default:
                writer.write(toJson(convertValue(resultSet.getObject(columnIndex))));
                return;
        }
    }

    private static int queryRowCount(Connection connection, String tableName) throws Exception {
        try (Statement statement = connection.createStatement(); ResultSet resultSet = statement.executeQuery("SELECT COUNT(*) AS count FROM " + quoteIdentifier(tableName))) {
            return resultSet.next() ? resultSet.getInt(1) : 0;
        }
    }

    private static Map<String, Object> perfMap(
        long startedAt,
        long afterQueryAt,
        long afterOffsetAt,
        long afterRowsAt,
        long afterCountAt,
        int offset,
        int fetchedRowCount,
        int limit,
        String tableName,
        String sql,
        int rowCount
    ) {
        Map<String, Object> perf = new LinkedHashMap<>();
        perf.put("tableName", tableName);
        perf.put("sql", sql);
        perf.put("offset", Integer.valueOf(offset));
        perf.put("limit", Integer.valueOf(limit));
        perf.put("fetchedRowCount", Integer.valueOf(fetchedRowCount));
        perf.put("rowCount", Integer.valueOf(rowCount));
        perf.put("queryMs", Long.valueOf((afterQueryAt - startedAt) / 1_000_000));
        perf.put("offsetMs", Long.valueOf((afterOffsetAt - afterQueryAt) / 1_000_000));
        perf.put("rowsMs", Long.valueOf((afterRowsAt - afterOffsetAt) / 1_000_000));
        perf.put("countMs", Long.valueOf((afterCountAt - afterRowsAt) / 1_000_000));
        perf.put("totalMs", Long.valueOf((afterCountAt - startedAt) / 1_000_000));
        return perf;
    }

    private static String buildTableDataSql(String tableName, int limit, int offset, String orderByColumn, String orderByDirection) {
        String quotedTableName = quoteIdentifier(tableName);
        String orderClause = orderByColumn != null && orderByDirection != null
            ? " ORDER BY " + quoteIdentifier(orderByColumn) + " " + ("ASC".equalsIgnoreCase(orderByDirection) ? "ASC" : "DESC")
            : "";

        if (limit >= 0 && offset <= 0) {
            return "SELECT TOP " + Math.max(1, limit) + " * FROM " + quotedTableName + orderClause;
        }

        return "SELECT * FROM " + quotedTableName + orderClause;
    }

    private static int getMaxRowsForTableData(int limit, int offset) {
        if (limit < 0) {
            return 0;
        }

        int safeLimit = Math.max(1, limit);
        int safeOffset = Math.max(0, offset);
        long requested = (long) safeLimit + (long) safeOffset;
        return requested > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) requested;
    }

    private static String quoteIdentifier(String identifier) {
        String[] parts = identifier.split("\\.");
        StringBuilder builder = new StringBuilder();

        for (int index = 0; index < parts.length; index += 1) {
            if (index > 0) {
                builder.append('.');
            }

            builder.append('[').append(parts[index].replace("]", "]]" )).append(']');
        }

        return builder.toString();
    }

    private static void writeStringArray(BufferedWriter writer, List<String> values) throws Exception {
        writer.write('[');

        for (int index = 0; index < values.size(); index += 1) {
            if (index > 0) {
                writer.write(',');
            }

            writer.write(quoteJson(values.get(index)));
        }

        writer.write(']');
    }

    private static String formatType(ResultSet resultSet) throws Exception {
        String typeName = resultSet.getString("TYPE_NAME");
        int columnSize = resultSet.getInt("COLUMN_SIZE");
        int decimalDigits = resultSet.getInt("DECIMAL_DIGITS");

        if (typeName == null) {
            return "TEXT";
        }

        String normalizedType = typeName.toUpperCase(Locale.ROOT);

        if ((normalizedType.contains("CHAR") || normalizedType.contains("BINARY")) && columnSize > 0 && !normalizedType.contains("(")) {
            return normalizedType + "(" + columnSize + ")";
        }

        if ((normalizedType.contains("DECIMAL") || normalizedType.contains("NUMERIC")) && columnSize > 0 && !normalizedType.contains("(")) {
            return decimalDigits > 0 ? normalizedType + "(" + columnSize + "," + decimalDigits + ")" : normalizedType + "(" + columnSize + ")";
        }

        return normalizedType;
    }

    private static String mapForeignKeyRule(short rule) {
        switch (rule) {
            case DatabaseMetaData.importedKeyCascade:
                return "CASCADE";
            case DatabaseMetaData.importedKeySetNull:
                return "SET NULL";
            case DatabaseMetaData.importedKeySetDefault:
                return "SET DEFAULT";
            case DatabaseMetaData.importedKeyRestrict:
                return "RESTRICT";
            default:
                return "NO ACTION";
        }
    }

    private static List<Object> decodeParams(String[] args, int offset) {
        List<Object> params = new ArrayList<>();
        for (int index = offset; index < args.length; index += 1) {
            params.add(decodeValue(args[index]));
        }
        return params;
    }

    private static Object decodeValue(String encoded) {
        int separatorIndex = encoded.indexOf(':');
        if (separatorIndex < 0) {
            throw new IllegalArgumentException("Invalid encoded value payload.");
        }

        String kind = encoded.substring(0, separatorIndex);
        String payload = encoded.substring(separatorIndex + 1);

        switch (kind) {
            case "null":
                return null;
            case "string":
                return decodeBase64Utf8(payload);
            case "number":
                return Double.valueOf(payload);
            case "bigint":
                return Long.valueOf(payload);
            case "bytes":
                return Base64.getDecoder().decode(payload);
            default:
                throw new IllegalArgumentException("Unsupported value kind: " + kind);
        }
    }

    private static String decodeBase64Utf8(String value) {
        return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
    }

    private static void bindParams(PreparedStatement statement, List<Object> params) throws Exception {
        for (int index = 0; index < params.size(); index += 1) {
            bindValue(statement, index + 1, params.get(index));
        }
    }

    private static void bindValue(PreparedStatement statement, int index, Object value) throws Exception {
        if (value == null) {
            statement.setObject(index, null);
            return;
        }

        if (value instanceof byte[]) {
            statement.setBytes(index, (byte[]) value);
            return;
        }

        statement.setObject(index, value);
    }

    private static long getGeneratedKey(PreparedStatement statement, int fallback) throws Exception {
        try (ResultSet keys = statement.getGeneratedKeys()) {
            if (keys != null && keys.next()) {
                return keys.getLong(1);
            }
        }

        return fallback;
    }

    private static Object convertValue(Object value) {
        if (value == null) {
            return null;
        }

        if (value instanceof Boolean) {
            return ((Boolean) value).booleanValue() ? Integer.valueOf(1) : Integer.valueOf(0);
        }

        if (value instanceof byte[]) {
            return Base64.getEncoder().encodeToString((byte[]) value);
        }

        if (value instanceof BigDecimal) {
            return ((BigDecimal) value).stripTrailingZeros().toPlainString();
        }

        if (value instanceof Timestamp) {
            return ((Timestamp) value).toInstant().atOffset(ZoneOffset.UTC).toString();
        }

        if (value instanceof java.sql.Date || value instanceof java.sql.Time) {
            return value.toString();
        }

        if (value instanceof Number) {
            return value;
        }

        return String.valueOf(value);
    }

    private static String toJson(Object value) {
        if (value == null) {
            return "null";
        }

        if (value instanceof String) {
            return quoteJson((String) value);
        }

        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }

        if (value instanceof Map) {
            StringBuilder builder = new StringBuilder();
            builder.append('{');
            boolean first = true;

            for (Object entryObject : ((Map<?, ?>) value).entrySet()) {
                Map.Entry<?, ?> entry = (Map.Entry<?, ?>) entryObject;
                if (!first) {
                    builder.append(',');
                }
                first = false;
                builder.append(quoteJson(String.valueOf(entry.getKey()))).append(':').append(toJson(entry.getValue()));
            }

            builder.append('}');
            return builder.toString();
        }

        if (value instanceof Iterable) {
            StringBuilder builder = new StringBuilder();
            builder.append('[');
            boolean first = true;

            for (Object item : (Iterable<?>) value) {
                if (!first) {
                    builder.append(',');
                }
                first = false;
                builder.append(toJson(item));
            }

            builder.append(']');
            return builder.toString();
        }

        return quoteJson(String.valueOf(value));
    }

    private static String quoteJson(String value) {
        StringBuilder builder = new StringBuilder();
        builder.append('"');

        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);

            switch (character) {
                case '\\':
                    builder.append("\\\\");
                    break;
                case '"':
                    builder.append("\\\"");
                    break;
                case '\n':
                    builder.append("\\n");
                    break;
                case '\r':
                    builder.append("\\r");
                    break;
                case '\t':
                    builder.append("\\t");
                    break;
                default:
                    if (character < 0x20) {
                        builder.append(String.format("\\u%04x", Integer.valueOf(character)));
                    } else {
                        builder.append(character);
                    }
                    break;
            }
        }

        builder.append('"');
        return builder.toString();
    }
}
`;
