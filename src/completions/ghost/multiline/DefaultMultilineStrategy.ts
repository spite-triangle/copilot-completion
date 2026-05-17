import { IMultilineStrategy, MultilineContext, IMultilineDetector } from './types';
import { DetectorChain } from './DetectorChain';
import { FileSizeGuardDetector } from './FileSizeGuardDetector';
import { NewLineDetector } from './NewLineDetector';
import { EmptyBlockDetector } from './EmptyBlockDetector';
import { MLModelDetector } from './MLModelDetector';
import { SuffixPresenceDetector } from './SuffixPresenceDetector';

export class DefaultMultilineStrategy implements IMultilineStrategy {
    readonly _serviceBrand: undefined;
    private readonly chain: DetectorChain;

    constructor(
        fileSizeGuard: IMultilineDetector = new FileSizeGuardDetector(),
        newLineDetector: IMultilineDetector = new NewLineDetector(),
        emptyBlock: IMultilineDetector = new EmptyBlockDetector(),
        mlModel: IMultilineDetector = new MLModelDetector(),
        suffixPresence: IMultilineDetector = new SuffixPresenceDetector(),
    ) {
        this.chain = new DetectorChain([
            fileSizeGuard,
            newLineDetector,
            emptyBlock,
            mlModel,
            suffixPresence,
        ]);
    }

    async determineMultiline(ctx: MultilineContext): Promise<boolean> {
        if (ctx.afterAccept) {
            return true;
        }
        const result = await this.chain.detect(ctx);
        return result.decision === 'multiline';
    }
}
