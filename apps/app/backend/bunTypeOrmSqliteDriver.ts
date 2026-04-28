import { Database, type Statement } from 'bun:sqlite';

type BunTypeOrmSqliteOptions = {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: ((sql: string) => void) | null;
};

function shouldUseRunForPragma(statement: string) {
    return statement.includes('=');
}

class BunTypeOrmSqliteStatement {
    readonly reader: boolean;

    constructor(
        private readonly statement: Statement,
        private readonly logQuery: ((sql: string) => void) | undefined,
        private readonly sql: string
    ) {
        this.reader = statement.columnNames.length > 0;
    }

    all(...parameters: unknown[]) {
        this.logQuery?.(this.sql);
        return this.statement.all(...parameters);
    }

    run(...parameters: unknown[]) {
        this.logQuery?.(this.sql);
        return this.statement.run(...parameters);
    }
}

export class BunTypeOrmSqliteDriver {
    private readonly database: Database;
    private readonly logQuery: ((sql: string) => void) | undefined;

    constructor(filename: string, options: BunTypeOrmSqliteOptions = {}) {
        const readonly = options.readonly === true;
        const create = filename === ':memory:' ? true : !readonly && options.fileMustExist !== true;

        this.database = new Database(filename, {
            readonly,
            readwrite: !readonly,
            create,
            strict: true,
        });
        this.logQuery = typeof options.verbose === 'function' ? options.verbose : undefined;

        if (typeof options.timeout === 'number' && Number.isFinite(options.timeout) && options.timeout > 0) {
            this.database.run(`PRAGMA busy_timeout = ${Math.trunc(options.timeout)}`);
        }
    }

    prepare(sql: string) {
        return new BunTypeOrmSqliteStatement(this.database.prepare(sql), this.logQuery, sql);
    }

    pragma(statement: string) {
        const sql = `PRAGMA ${statement}`;
        this.logQuery?.(sql);

        if (shouldUseRunForPragma(statement)) {
            this.database.run(sql);
            return [];
        }

        return this.database.query(sql).all();
    }

    exec(sql: string) {
        this.logQuery?.(sql);
        return this.database.exec(sql);
    }

    close() {
        this.database.close();
    }
}
