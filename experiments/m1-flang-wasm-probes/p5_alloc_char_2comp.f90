program p
  type :: t
    integer :: n
    character(len=:), allocatable :: name
  end type
  type(t), allocatable :: b
  allocate(b)
  b%n = 7
  b%name = "hello"
  print *, "P5 OK ", b%n, b%name
end program
