import type { GetOriginalSizeResult, Handle, RenderResult, RPCRequest, SerializableRenderParams } from "./protocol.js";
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type RPCRequestBody = DistributiveOmit<RPCRequest, "id">;
export declare class WorkerChannel {
    private nextId;
    private readonly pending;
    private readonly worker;
    private readonly objectUrl;
    constructor(worker: Worker, objectUrl: string | null);
    call<T>(req: RPCRequestBody, transfer?: Transferable[]): Promise<T>;
    terminate(): void;
}
export type PDFiumWorkerRenderParams = SerializableRenderParams;
export type PDFiumWorkerRenderResult = RenderResult;
export declare class PDFiumWorkerPage {
    readonly number: number;
    private readonly handle;
    private readonly channel;
    constructor(channel: WorkerChannel, handle: Handle, pageIndex: number);
    getText(): Promise<string>;
    getOriginalSize(): Promise<GetOriginalSizeResult>;
    render(options?: PDFiumWorkerRenderParams): Promise<PDFiumWorkerRenderResult>;
    close(): Promise<void>;
}
export declare class PDFiumWorkerDocument {
    private readonly handle;
    private readonly channel;
    constructor(channel: WorkerChannel, handle: Handle);
    getPageCount(): Promise<number>;
    getPage(pageIndex: number): Promise<PDFiumWorkerPage>;
    pages(): AsyncGenerator<PDFiumWorkerPage>;
    destroy(): Promise<void>;
}
export declare class PDFiumWorkerClientBase {
    protected readonly channel: WorkerChannel;
    constructor(channel: WorkerChannel);
    loadDocument(bytes: Uint8Array, password?: string): Promise<PDFiumWorkerDocument>;
    destroy(): Promise<void>;
}
export type PDFiumWorkerSpawnInternalOptions = {
    workerSource: string;
    init: {
        wasmUrl?: string;
        wasmBinary?: ArrayBuffer;
    };
};
export declare function spawnWorkerChannel(opts: PDFiumWorkerSpawnInternalOptions): Promise<WorkerChannel>;
export {};
