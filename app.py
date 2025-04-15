def fibonacci(n):
    a = 0
    b = 1

    print(a)
    print(b)

    for i in range(2, n):
        c = a + b
        a = b
        b = c 
        print(c)

fibonacci(10)


def factorial(n):
    res = 1
    for i in range(1, n+1):
        res *= i
        
    print(res)

factorial(4)