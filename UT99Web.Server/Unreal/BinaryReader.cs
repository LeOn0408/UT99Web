using System.Buffers.Binary;
using System.Text;

namespace UT99Web.Server.Unreal;

public sealed class BinaryReader(byte[] buffer, int offset = 0)
{
    public int Offset { get; private set; } = offset;
    public int Length => buffer.Length;
    public int Remaining => buffer.Length - Offset;

    public void Seek(int offset)
    {
        if (offset < 0 || offset > buffer.Length) throw new ArgumentOutOfRangeException(nameof(offset));
        Offset = offset;
    }

    public byte U8() => buffer[Offset++];

    public ushort U16()
    {
        var value = BinaryPrimitives.ReadUInt16LittleEndian(buffer.AsSpan(Offset, 2));
        Offset += 2;
        return value;
    }

    public uint U32()
    {
        var value = BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(Offset, 4));
        Offset += 4;
        return value;
    }

    public int I32()
    {
        var value = BinaryPrimitives.ReadInt32LittleEndian(buffer.AsSpan(Offset, 4));
        Offset += 4;
        return value;
    }

    public float F32()
    {
        var value = BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(Offset, 4));
        Offset += 4;
        return value;
    }

    public int CompactIndex()
    {
        var value = U8();
        var negative = (value & 0x80) != 0;
        var result = value & 0x3f;
        if ((value & 0x40) != 0)
        {
            var shift = 6;
            do
            {
                value = U8();
                result |= (value & 0x7f) << shift;
                shift += 7;
            } while ((value & 0x80) != 0 && shift < 35);
        }
        return negative ? -result : result;
    }

    public string CString()
    {
        var bytes = new List<byte>();
        while (Offset < buffer.Length)
        {
            var value = buffer[Offset++];
            if (value == 0) break;
            bytes.Add(value);
        }
        return Encoding.ASCII.GetString(bytes.ToArray());
    }

    public string FString()
    {
        var length = (int)U8();
        if ((length & 0x80) != 0) length = (length & 0x7f) | (U8() << 7);
        if (length == 0) return string.Empty;
        var raw = buffer.AsSpan(Offset, length);
        Offset += length;
        var end = raw.Length;
        while (end > 0 && raw[end - 1] == 0) end--;
        return Encoding.ASCII.GetString(raw[..end]);
    }
}
