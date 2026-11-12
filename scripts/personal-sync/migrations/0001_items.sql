CREATE TABLE buzz_items (
    owner TEXT NOT NULL,
    community TEXT NOT NULL,
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('saved', 'todo')),
    text TEXT NOT NULL,
    target TEXT,
    due INTEGER,
    done INTEGER NOT NULL CHECK (done IN (0, 1)),
    deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
    revision INTEGER NOT NULL CHECK (revision > 0),
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    PRIMARY KEY (owner, community, id)
);
