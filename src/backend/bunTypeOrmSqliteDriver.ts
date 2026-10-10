import Database from 'better-sqlite3';

type BunTypeOrmSqliteOptions = {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: ((sql: string) => void) | null;
};

/** `safeIntegers` hands every SQLite integer back as a BigInt; schema metadata (a cid, a
 *  `notnull`/`pk` flag) is read by TypeORM as a plain number, so pragma results are downcast. */
function toPragmaNumbers(result: unknown): unknown {
    if (Array.isArray(result)) {
        return result.map(toPragmaNumbers);
    }

    if (typeof result === 'bigint') {
        return Number(result);
    }

    if (result && typeof result === 'object') {
        return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, toPragmaNumbers(value)]));
    }

    return result;
}

class BunTypeOrmSqliteStatement {
    readonly reader: boolean;

    constructor(
        private readonly statement: Database.Statement,
        private readonly logQuery: ((sql: string) => void) | undefined,
        private readonly sql: string
    ) {
        // `columns()` throws on statements that return no data (INSERT/UPDATE/…), which is
        // exactly the statements TypeORM asks the `reader` flag about.
        this.reader = statement.reader;
    }

    all(...parameters: unknown[]) {
        this.logQuery?.(this.sql);
        return this.statement.all(...parameters);
    }

    /** Result column names, available before the statement is executed. */
    columns() {
        return this.statement.columns();
    }

    run(...parameters: unknown[]) {
        this.logQuery?.(this.sql);
        return this.statement.run(...parameters);
    }
}

export class BunTypeOrmSqliteDriver {
    private readonly database: Database.Database;
    private readonly logQuery: ((sql: string) => void) | undefined;

    constructor(filename: string, options: BunTypeOrmSqliteOptions = {}) {
        const readonly = options.readonly === true;

        this.database = new Database(filename, {
            readonly,
            fileMustExist: options.fileMustExist,
            timeout: typeof options.timeout === 'number' && Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 5000,
        });
        this.logQuery = typeof options.verbose === 'function' ? options.verbose : undefined;

        // A JS number cannot hold every 64-bit SQLite integer: reading one without this returns
        // a rounded value, and saving an edit then writes the rounded value back.
        this.database.defaultSafeIntegers(true);
        this.database.pragma('journal_mode = WAL');
    }

    prepare(sql: string) {
        return new BunTypeOrmSqliteStatement(this.database.prepare(sql), this.logQuery, sql);
    }

    pragma(statement: string) {
        this.logQuery?.(`PRAGMA ${statement}`);
        return toPragmaNumbers(this.database.pragma(statement, { simple: false }));
    }

    exec(sql: string) {
        this.logQuery?.(sql);
        return this.database.exec(sql);
    }

    close() {
        this.database.close();
    }
}
