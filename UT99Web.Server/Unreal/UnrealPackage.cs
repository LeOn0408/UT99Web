namespace UT99Web.Server.Unreal;

public sealed record UnrealName(string Text, uint Flags);

public sealed record UnrealImport(string? ClassPackage, string? ClassName, int PackageIndex, string? ObjectName);

public sealed record UnrealExport(
    int Index,
    int ClassIndex,
    int SuperIndex,
    int PackageIndex,
    string? ObjectName,
    uint ObjectFlags,
    int SerialSize,
    int SerialOffset,
    string? ClassName);

public sealed class UnrealPackage
{
    public required int Version { get; init; }
    public required List<UnrealName> Names { get; init; }
    public required List<UnrealImport> Imports { get; init; }
    public required List<UnrealExport> Exports { get; init; }
    public required byte[] Buffer { get; init; }

    public string? ResolveObjectName(int reference)
    {
        if (reference < 0) return Imports.ElementAtOrDefault(-reference - 1)?.ObjectName;
        if (reference == 0) return null;
        return Exports.ElementAtOrDefault(reference - 1)?.ObjectName;
    }

    public static UnrealPackage Load(string path)
    {
        var buffer = File.ReadAllBytes(path);
        var reader = new BinaryReader(buffer);
        var signature = reader.U32();
        if (signature != 0x9e2a83c1)
        {
            throw new InvalidDataException($"Unexpected package signature 0x{signature:x8}");
        }

        var version = reader.U16();
        reader.U16();
        reader.U32();
        var nameCount = reader.U32();
        var nameOffset = reader.U32();
        var exportCount = reader.U32();
        var exportOffset = reader.U32();
        var importCount = reader.U32();
        var importOffset = reader.U32();

        if (nameCount > 1_000_000 || exportCount > 1_000_000 || importCount > 1_000_000)
        {
            throw new InvalidDataException("Package table is too large");
        }

        reader.Seek((int)nameOffset);
        var names = new List<UnrealName>((int)nameCount);
        for (var index = 0; index < nameCount; index++)
        {
            var text = version <= 61 ? reader.CString() : reader.FString();
            names.Add(new UnrealName(text, reader.U32()));
        }

        reader.Seek((int)importOffset);
        var imports = new List<UnrealImport>((int)importCount);
        for (var index = 0; index < importCount; index++)
        {
            var classPackage = reader.CompactIndex();
            var className = reader.CompactIndex();
            var packageIndex = reader.I32();
            var objectName = reader.CompactIndex();
            imports.Add(new UnrealImport(
                names.ElementAtOrDefault(classPackage)?.Text,
                names.ElementAtOrDefault(className)?.Text,
                packageIndex,
                names.ElementAtOrDefault(objectName)?.Text));
        }

        reader.Seek((int)exportOffset);
        var exports = new List<UnrealExport>((int)exportCount);
        for (var index = 0; index < exportCount; index++)
        {
            var classIndex = reader.CompactIndex();
            var superIndex = reader.CompactIndex();
            var packageIndex = reader.I32();
            var objectNameIndex = reader.CompactIndex();
            var objectFlags = reader.U32();
            var serialSize = reader.CompactIndex();
            var serialOffset = serialSize != 0 ? reader.CompactIndex() : 0;
            var objectName = names.ElementAtOrDefault(objectNameIndex)?.Text;
            string? className = null;
            if (classIndex < 0) className = imports.ElementAtOrDefault(-classIndex - 1)?.ObjectName;
            else if (classIndex > 0) className = exports.ElementAtOrDefault(classIndex - 1)?.ObjectName;
            exports.Add(new UnrealExport(
                index,
                classIndex,
                superIndex,
                packageIndex,
                objectName,
                objectFlags,
                serialSize,
                serialOffset,
                className));
        }

        return new UnrealPackage
        {
            Version = version,
            Names = names,
            Imports = imports,
            Exports = exports,
            Buffer = buffer
        };
    }
}
