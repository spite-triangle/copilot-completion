import { ServiceIdentifier, IInstantiationService } from './instantiation';
import { SyncDescriptor } from './descriptors';
import { ServiceCollection } from './serviceCollection';
import { InstantiationService } from './instantiationService';
import { createDecorator } from './instantiation';
import { CurrentGhostText, LastGhostText } from '../completions/ghost/ghostTextState';

export { ServiceIdentifier, SyncDescriptor, createDecorator as createServiceIdentifier };

export const ICurrentGhostText = createDecorator<CurrentGhostText>('ICurrentGhostText');
export const ILastGhostText = createDecorator<LastGhostText>('ILastGhostText');

export class InstantiationServiceBuilder {
	private readonly _collection: ServiceCollection;

	constructor(entries?: [ServiceIdentifier<unknown>, unknown][]) {
		this._collection = new ServiceCollection(...(entries || []));
	}

	define<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): void {
		this._collection.set(id, instanceOrDescriptor);
	}

	seal(): IInstantiationService {
		return new InstantiationService(this._collection, true);
	}
}
