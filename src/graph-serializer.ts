/**
 * A scheme is in the context of our serializer defined as a pair of a serializer and a deserializer.
 */
export class Scheme {
	public serializer: (v: any) => any = (v: any) => v;
	public deserializer: (v: any) => any = (v: any) => v;
}

/**
 * This interface should define all decorator parameters you can supply to the @serializable decorator.
 */
export interface DescriptionSettings {
	scheme?: Scheme;
	serializedName?: string;
	postDeserialize?: Function;
	direction?: ("serialize" | "deserialize")[];
}

export interface ClassConstructor {
	new(): any;

	[index: string]: any;
}

/**
 * Property decorator storage.
 *
 * If you ever want to add a class decorator option, you can do so here. Be sure to also add your option to the
 * DescriptionSettings interface defined above, for autocompletion in your favourite IDE.
 */
export class PropertyDescription {
	public scheme: Scheme;
	public name: string;
	public serializedName: string;
	public direction: ("serialize" | "deserialize")[] = ["serialize", "deserialize"];

	public constructor(propertyName: string, settings: DescriptionSettings = {}) {
		this.name = propertyName;
		this.setDecoration(settings);
	}

	/**
	 * Add new property decorator settings here.
	 *
	 * @param {DescriptionSettings} settings
	 * @returns {PropertyDescription}
	 */
	public setDecoration(settings: DescriptionSettings): PropertyDescription {
		this.scheme = settings.scheme || new Scheme();
		this.serializedName = settings.serializedName || this.name;
		this.direction = settings.direction || this.direction;

		return this;
	}
}

/**
 * Class decorator storage.
 *
 * If you ever want to add a class decorator option, you can do so here. Be sure to also add your option to the
 * DescriptionSettings interface defined above, for autocompletion in your favourite IDE.
 */
export class ClassDescription {

	public postDeserialize: Function;

	public deserializationFactory = (data: any) => {
		return new this.classConstructor();
	};

	public properties: Map<string, PropertyDescription> = new Map();

	constructor(private classConstructor: ClassConstructor) {
	}

	/**
	 * Store decoration
	 * @param {DescriptionSettings} settings
	 * @returns {ClassDescription}
	 */
	public setDecoration(settings: DescriptionSettings): ClassDescription {
		if (typeof settings === 'undefined') {
			return this;
		}

		this.postDeserialize = settings.postDeserialize || undefined;

		return this;
	}
}

/**
 * Main decorator storage. This class will store and provide access to all decorators. An instance is instantiated
 * below.
 */
export class Store {

	private map: Map<any, ClassDescription> = new Map();

	/**
	 * Override Map getter. When no class description is found, we want to instantiate and return one. Class decorators
	 * are optional, and this ensures we will get a default one when requested
	 *
	 * @param key
	 * @returns {ClassDescription}
	 */
	public get(key: any): ClassDescription {
		if (!this.map.has(key)) {
			this.map.set(key, new ClassDescription(key));
		}

		return this.map.get(key);
	}

	/**
	 * Setter
	 * @param key
	 * @param {ClassDescription} value
	 */
	public set(key: any, value: ClassDescription) {
		this.map.set(key, value);
	}
}

/**
 * Store object to hold our configuration. This needs not be exported because is should only be used internally.
 * @type {Store}
 */
const store = new Store();

/**
 * Serializer. Converts a JSON serializable tree to an object instance.
 *
 * @param type
 * @param src
 * @returns {any}
 */
export function deserialize(type: any, src: any): any {
	if (src === null) {
		return null;
	}

	//Construct a runtime ClassDescription containing the current inheritance stack
	let classDescription = createClassDescription(type);
	let ret = classDescription.deserializationFactory(src);

	classDescription.properties.forEach((property: PropertyDescription) => {
		if (typeof src[property.serializedName] !== 'undefined' && property.direction.indexOf("deserialize") !== -1) {
			ret[property.name] = property.scheme.deserializer(src[property.serializedName]);
		}
	});

	if (typeof classDescription.postDeserialize === "function") {
		classDescription.postDeserialize(ret);
	}

	return ret;
}

/**
 * Deserializer function. Converts an object to a JSON serializable graph.
 *
 * @param src
 * @returns {{[p: string]: any}}
 */
export function serialize(src: any): { [key: string]: any } {
	if (src === null) {
		return null;
	} else if (Object.getPrototypeOf(src) === Object.prototype) {
		return src;
	}

	let ret: { [key: string]: any } = {};
	let classDescription = createClassDescription(Object.getPrototypeOf(src).constructor);

	classDescription.properties.forEach(
		(property: PropertyDescription) => {
			if (property.direction.indexOf("serialize") !== -1) {
				ret[property.serializedName] = property.scheme.serializer(src[property.name]);
			}
		}
	);

	return ret;
}

/**
 * Construct a runtime ClassDescription containing the current inheritance stack
 *
 * @param type
 */
function createClassDescription(type: ClassConstructor): ClassDescription {

	let cursor = type;
	let classDescription = new ClassDescription(type);
	do {
		let cursorClassDescription = store.get(cursor);
		if (cursor === type) { //Only first item in the stack (ie. the implementation) can set deserializationFactory.
			classDescription.deserializationFactory = cursorClassDescription.deserializationFactory;
		}

		classDescription.postDeserialize = classDescription.postDeserialize || cursorClassDescription.postDeserialize;

		cursorClassDescription.properties.forEach((property: PropertyDescription) => {
			if (!classDescription.properties.has(property.serializedName)) {
				classDescription.properties.set(property.serializedName, property);
			}
		});
	} while ((cursor = Object.getPrototypeOf(cursor)) instanceof Function);

	return classDescription;
}

/**
 * Primitive scheme type.
 * The default scheme. This will return properties as-is on deserialize. This is exported as const because
 * the primitive scheme should never change.
 * @type {Scheme}
 */
export const primitive = new Scheme();

/**
 * Date scheme type.
 * This scheme will properly serialize and deserialize javascript Date objects.
 *
 * Example usage:
 * ```
 * class TestClass {
 *  @serializable(date)
 *  public children: Date;
 * }
 * ```
 *
 * @type {Scheme}
 */
export const date = (function () {
	let scheme = new Scheme();
	scheme.serializer = (v: Date) => (v instanceof Date) ? v.toJSON() : v;
	scheme.deserializer = (v: string) => (typeof v === 'string') ? new Date(v) : v;
	return scheme;
})();

/**
 * Array scheme type
 * The array function will apply a scheme to all of its children.
 *
 * Example usage:
 * ```
 * class TestClass {
 *  @serializable(array())
 *  public children: string[];
 * }
 * ```
 *
 * @param {Scheme} childScheme
 * @returns {Scheme}
 */
export function array(childScheme: Scheme = primitive) {
	let scheme = new Scheme();
	scheme.serializer = (v: any) => {
		return v.map((w: any) => childScheme.serializer(w))
	};
	scheme.deserializer = (v: any) => {
		if (v === undefined) return v;
		return v.map((w: any) => childScheme.deserializer(w))
	};
	return scheme;
}

/**
 * Array scheme type
 * The array function will apply a scheme to all of its children.
 *
 * Example usage:
 * ```
 * class TestClass {
 *  @serializable(array())
 *  public children: string[];
 * }
 * ```
 *
 * @param {Scheme} childScheme
 * @returns {Scheme}
 */
export function objectMap(childScheme: Scheme = primitive) {
	let scheme = new Scheme();

	scheme.serializer = (v: { [key: string]: any }) => {
		if (v === undefined || typeof v !== "object") {
			return v;
		}

		const ret: { [key: string]: any } = {};
		for (const k in v) {
			if (v.hasOwnProperty(k) === true) {
				ret[k] = childScheme.serializer(v[k]);
			}
		}

		return ret;
	};

	scheme.deserializer = (v: { [key: string]: any }) => {
		if (v === undefined || typeof v !== "object") {
			return v;
		}

		const ret: { [key: string]: any } = {};
		for (const k in v) {
			if (v.hasOwnProperty(k) === true) {
				ret[k] = childScheme.deserializer(v[k]);
			}
		}

		return ret;

	};

	return scheme;
}

/**
 * Object scheme type
 * The object function will serialize a nested object
 *
 * Example usage:
 * ```
 * class A { name: string }
 * class B {
 *   @serializable(object(A))
 *   public nestedObject: A;
 * }
 * ```
 *
 * @param type
 * @returns {Scheme}
 */
export function object(type: any): Scheme {
	let scheme = new Scheme();
	scheme.serializer = (v: any) => serialize(v);
	scheme.deserializer = (v: any) => deserialize(type, v);
	return scheme;
}

/**
 * Custom scheme type
 * The custom function allows you to create your own serializer functionality. Used in polymorph types and arrays.
 *
 * Example usage:
 * ```
 * class A { public type = 'a'; }
 * class B { public type = 'b'; }
 * class TestClass {
 *  @serializable(custom(
 *      (v:any)=>v,
 *      (v:any) => deserialize({
 *          'a':A,
 *          'b':B
 *      }[v.type],v)
 *  ))
 *  public test: A|B;
 * }
 * ```
 *
 * @param {(v: any) => any} serializer
 * @param {(v: any) => any} deserializer
 * @returns {Scheme}
 */
export function custom(serializer: (v: any) => any, deserializer: (v: any) => any): Scheme {
	let scheme = new Scheme();
	scheme.serializer = serializer;
	scheme.deserializer = deserializer;
	return scheme;
}


/**
 * Decorator function. This is the only function to decorate your typescript classes with; it servers as both a class
 * decorator and a property decorator.
 *
 * @param {DescriptionSettings} settings
 * @returns {any}
 */
export function serializable(settings: DescriptionSettings = {}): any {

	return function (type: any, propertyName: string) {

		if (arguments.length === 1) { // Class decorator
			store.get(type).setDecoration(settings);
		} else if (arguments.length === 3) { // Property decorator
			store.get(type.constructor).properties.set(propertyName, new PropertyDescription(propertyName, settings));
		} else {
			throw new Error("Invalid decorator");
		}
	};
}

/**
 * postDeserialize decorator. If you are using an AOT build of your project, the class annotation for the
 * serializer cannot be used because functions are not allowed in the class decorator.
 * Therefore, you should create a *static member function* for postDeserialization and annotate it with this function.
 *
 * @returns {any}
 */
export function postDeserialize(): any {
	return function (type: any, propertyName: string, propertyDescriptor: any) {
		if (arguments.length !== 3) {
			throw new Error("Invalid decorator")
		}
		let classDescriptor = store.get(type);
		classDescriptor.postDeserialize = propertyDescriptor.value;
		store.set(type, classDescriptor);
	}
}

/**
 * DeserializationFactory decorator. Mark a static method as a factory to create an instance of the type during
 * deserialization.
 *
 * @returns {any}
 */
export function deserializationFactory(): any {
	return function (type: any, propertyName: string, propertyDescriptor: any) {
		if (arguments.length !== 3) {
			throw new Error("Invalid decorator")
		}

		let classDescriptor = store.get(type);
		classDescriptor.deserializationFactory = propertyDescriptor.value;
		store.set(type, classDescriptor);
	}
}
